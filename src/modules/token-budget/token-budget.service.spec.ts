import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TokenBudgetService } from './token-budget.service';
import { TokenBudgetRepository } from './token-budget.repository';
import {
  ActiveBudgetDocument,
  LedgerEntry,
  ResetAuditEntry,
} from './token-budget.types';

describe('TokenBudgetService', () => {
  let service: TokenBudgetService;
  let mockDoc: ActiveBudgetDocument;
  let writtenLedger: LedgerEntry[] = [];
  let writtenResets: ResetAuditEntry[] = [];
  let configMap: Record<string, string | number>;

  const createMockRepo = () => ({
    getActiveBudget: jest.fn(() =>
      Promise.resolve({
        ...mockDoc,
        _etag: mockDoc._etag || 'etag-1',
      }),
    ),
    replaceActiveBudget: jest.fn((doc: ActiveBudgetDocument) => {
      mockDoc = {
        ...doc,
        _etag: `etag-${Date.now()}`,
      };
      return Promise.resolve(mockDoc);
    }),
    writeLedgerEntry: jest.fn((entry: LedgerEntry) => {
      writtenLedger.push(entry);
      return Promise.resolve();
    }),
    writeResetAuditEntry: jest.fn((entry: ResetAuditEntry) => {
      writtenResets.push(entry);
      return Promise.resolve();
    }),
  });

  beforeEach(async () => {
    configMap = {
      AI_TOKEN_BUDGET_ENABLED: 'true',
      AI_TOKEN_BUDGET_LIMIT: 10000,
      AI_TOKEN_BUDGET_WINDOW_HOURS: 24,
      AI_TOKEN_BUDGET_MANUAL_RESET_ENABLED: 'true',
      NODE_ENV: 'development',
    };

    mockDoc = {
      id: 'active_budget',
      pk: 'global',
      budgetLimit: 10000,
      windowHours: 24,
      generation: 1,
      buckets: {},
      reservations: {},
      processedEvents: {},
      updatedAt: new Date().toISOString(),
      _etag: 'etag-init',
    };

    writtenLedger = [];
    writtenResets = [];

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenBudgetService,
        {
          provide: TokenBudgetRepository,
          useValue: createMockRepo(),
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => configMap[key]),
          },
        },
      ],
    }).compile();

    service = module.get<TokenBudgetService>(TokenBudgetService);
  });

  describe('Scenario 1: New request allowed when budget available', () => {
    it('allows reservation when usage is within 10,000 tokens', async () => {
      const result = await service.reserveTokens({
        stage: 'text_analyst',
        process: 'lead_validator',
        model: 'gpt-5-mini',
        modelEnv: 'OPENAI_TEXT_MODEL',
        estimatedTokens: 500,
      });

      expect(result.allowed).toBe(true);
      expect(result.reservationId).toBeDefined();
      expect(result.remainingTokens).toBe(9500);
      expect(Object.keys(mockDoc.reservations).length).toBe(1);
    });
  });

  describe('Scenario 2: Actual model usage persisted and reconciled', () => {
    it('records actual usage, releases remaining reservation, and writes ledger', async () => {
      const reservation = await service.reserveTokens({
        stage: 'crew_call',
        process: 'agent_crew',
        model: 'gpt-5.1',
        modelEnv: 'AGENT_CREW_MODEL',
        estimatedTokens: 1000,
      });

      expect(reservation.allowed).toBe(true);
      const resId = reservation.reservationId!;

      const reconcileResult = await service.reconcileUsage({
        reservationId: resId,
        actualUsage: {
          inputTokens: 300,
          outputTokens: 250,
          totalTokens: 550,
        },
        success: true,
      });

      expect(reconcileResult.success).toBe(true);
      expect(reconcileResult.actualTokens).toBe(550);
      expect(reconcileResult.freedTokens).toBe(450); // 1000 - 550 = 450 released back
      expect(mockDoc.reservations[resId]).toBeUndefined();

      // Check current snapshot
      const snapshot = await service.getSnapshot();
      expect(snapshot.currentUsage).toBe(550);
      expect(snapshot.currentReserved).toBe(0);
      expect(snapshot.remainingBudget).toBe(9450);

      // Verify ledger entry
      expect(writtenLedger.length).toBe(1);
      expect(writtenLedger[0].totalTokens).toBe(550);
      expect(writtenLedger[0].reservationId).toBe(resId);
    });
  });

  describe('Scenario 3: Reaching 10,000 tokens prevents any new AI call', () => {
    it('rejects new reservations once 10,000 tokens are committed', async () => {
      // Simulate existing bucket usage of 9500 tokens
      const now = Date.now();
      const bucketKey = (Math.floor(now / 900000) * 900000).toString();
      mockDoc.buckets[bucketKey] = 9500;

      // Check budget
      const checkResult = await service.checkBudgetAvailable(600);
      expect(checkResult.allowed).toBe(false);
      expect(checkResult.reason).toBe('AI_TOKEN_BUDGET_EXHAUSTED');

      // Attempt reservation of 600 tokens -> should be rejected
      const reserveResult = await service.reserveTokens({
        stage: 'vision_call',
        process: 'agent_crew',
        model: 'gpt-5-mini',
        modelEnv: 'OPENAI_IMAGE_MODEL',
        estimatedTokens: 600,
      });

      expect(reserveResult.allowed).toBe(false);
      expect(reserveResult.reason).toBe('AI_TOKEN_BUDGET_EXHAUSTED');
      expect(reserveResult.remainingTokens).toBe(500);
    });
  });

  describe('Scenario 4: Raising limit through ENV changes permitted budget', () => {
    it('dynamically respects increased limit (e.g. 50,000) without code change', async () => {
      // Set limit in ENV to 50,000
      configMap.AI_TOKEN_BUDGET_LIMIT = 50000;

      // Existing usage is 12,000 tokens
      const now = Date.now();
      const bucketKey = (Math.floor(now / 900000) * 900000).toString();
      mockDoc.buckets[bucketKey] = 12000;

      const result = await service.reserveTokens({
        stage: 'deep_agent',
        process: 'whatsapp_agent',
        model: 'gpt-5-mini',
        modelEnv: 'WHATSAPP_AGENT_LLM_MODEL',
        estimatedTokens: 1000,
      });

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(50000);
      expect(result.remainingTokens).toBe(50000 - 12000 - 1000);
    });
  });

  describe('Scenario 5: Usage older than rolling 24-hour window is excluded', () => {
    it('prunes time buckets older than 24 hours', async () => {
      const now = Date.now();
      const currentBucket = (Math.floor(now / 900000) * 900000).toString();
      const oldBucket = (now - 26 * 3600 * 1000).toString(); // 26 hours ago

      mockDoc.buckets[oldBucket] = 8000; // should be excluded & pruned
      mockDoc.buckets[currentBucket] = 1500; // should be kept

      const snapshot = await service.getSnapshot();
      expect(snapshot.currentUsage).toBe(1500);
      expect(mockDoc.buckets[oldBucket]).toBeUndefined(); // pruned from doc
    });
  });

  describe('Scenario 6: Unknown usage does not silently become zero', () => {
    it('reconciles with conservative estimated tokens when call fails with error', async () => {
      const res = await service.reserveTokens({
        stage: 'eval_call',
        process: 'lead_validator',
        model: 'gpt-5-mini',
        modelEnv: 'OPENAI_EVALUATION_MODEL',
        estimatedTokens: 800,
      });

      // Call fails with network timeout -> usage is unknown
      await service.reconcileUsage({
        reservationId: res.reservationId!,
        actualUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 800, // conservative reservation retained
        },
        success: false,
        error: new Error('Network timeout'),
      });

      const snapshot = await service.getSnapshot();
      // Usage is counted as 800 tokens, NOT 0
      expect(snapshot.currentUsage).toBe(800);
    });
  });

  describe('Scenario 7 & 20: Global sharing & abandoned reservation auto-recovery', () => {
    it('auto-recovers stale reservations older than TTL', async () => {
      const now = Date.now();
      // Add an abandoned reservation from 10 minutes ago
      mockDoc.reservations['abandoned_1'] = {
        id: 'abandoned_1',
        stage: 'crashed_worker',
        process: 'crew',
        model: 'gpt-5.1',
        modelEnv: 'AGENT_CREW_MODEL',
        reservedTokens: 2000,
        createdAt: now - 600000,
        expiresAt: now - 300000, // expired 5 minutes ago
      };

      const snapshot = await service.getSnapshot();
      expect(snapshot.currentReserved).toBe(0);
      expect(mockDoc.reservations['abandoned_1']).toBeUndefined();
    });
  });

  describe('Scenarios 22-25: Manual Reset Implementation', () => {
    it('Scenario 25: refuses manual reset when NODE_ENV is production', async () => {
      configMap.NODE_ENV = 'production';
      await expect(service.manualReset({ confirm: true })).rejects.toThrow(
        /strictly forbidden in production/i,
      );
    });

    it('Scenario 24: refuses reset when AI_TOKEN_BUDGET_MANUAL_RESET_ENABLED is false', async () => {
      configMap.AI_TOKEN_BUDGET_MANUAL_RESET_ENABLED = 'false';
      await expect(service.manualReset({ confirm: true })).rejects.toThrow(
        /Manual reset is disabled/i,
      );
    });

    it('requires explicit confirmation flag', async () => {
      await expect(service.manualReset({ confirm: false })).rejects.toThrow(
        /Explicit confirmation is required/i,
      );
    });

    it('refuses reset if active unexpired reservations exist without force', async () => {
      await service.reserveTokens({
        stage: 'in_flight',
        process: 'crew',
        model: 'gpt-5.1',
        modelEnv: 'AGENT_CREW_MODEL',
        estimatedTokens: 500,
      });

      await expect(
        service.manualReset({ confirm: true, force: false }),
      ).rejects.toThrow(/active, unexpired reservations/i);
    });

    it('Scenario 22 & 23: resets budget, bumps generation, and records audit entry', async () => {
      const now = Date.now();
      const bucketKey = (Math.floor(now / 900000) * 900000).toString();
      mockDoc.buckets[bucketKey] = 7500;

      const resetResult = await service.manualReset({ confirm: true });
      expect(resetResult.success).toBe(true);
      expect(resetResult.previousGeneration).toBe(1);
      expect(resetResult.newGeneration).toBe(2);
      expect(resetResult.previousUsage).toBe(7500);

      // Verify active state is now 0 tokens
      const snapshot = await service.getSnapshot();
      expect(snapshot.currentUsage).toBe(0);
      expect(snapshot.generation).toBe(2);

      // Verify audit record written
      expect(writtenResets.length).toBe(1);
      expect(writtenResets[0].previousUsage).toBe(7500);
      expect(writtenResets[0].newGeneration).toBe(2);
    });
  });
});
