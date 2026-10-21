import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TokenBudgetService } from './token-budget.service';
import { TokenBudgetRepository } from './token-budget.repository';
import {
  ActiveBudgetDocument,
  LedgerEntry,
  ResetAuditEntry,
} from './token-budget.types';

describe('TokenBudget Concurrency & Idempotency (Scenarios 15-21)', () => {
  let service: TokenBudgetService;
  let sharedCosmosDoc: ActiveBudgetDocument;
  let currentEtag: string;
  let writeConflictCount = 0;
  let successfulReplaces = 0;

  // Realistic Cosmos DB simulator with conditional IfMatch ETag checking
  const mockRepo = {
    getActiveBudget: jest.fn(async () => {
      // Simulate point read
      return JSON.parse(
        JSON.stringify({
          ...sharedCosmosDoc,
          _etag: currentEtag,
        }),
      );
    }),
    replaceActiveBudget: jest.fn(
      async (doc: ActiveBudgetDocument, ifMatchEtag?: string) => {
        // Small simulated network latency
        await new Promise((resolve) =>
          setTimeout(resolve, Math.floor(Math.random() * 8) + 2),
        );

        // Simulate Cosmos DB ETag Precondition check
        if (ifMatchEtag && ifMatchEtag !== currentEtag) {
          writeConflictCount++;
          const error: any = new Error('Precondition Failed: ETag mismatch');
          error.statusCode = 412;
          error.code = 412;
          throw error;
        }

        successfulReplaces++;
        currentEtag = `etag_${Date.now()}_${Math.random()}`;
        sharedCosmosDoc = JSON.parse(
          JSON.stringify({
            ...doc,
            _etag: currentEtag,
          }),
        );
        return sharedCosmosDoc;
      },
    ),
    writeLedgerEntry: jest.fn(async (_entry: LedgerEntry) => {}),
    writeResetAuditEntry: jest.fn(async (_entry: ResetAuditEntry) => {}),
  };

  beforeEach(async () => {
    writeConflictCount = 0;
    successfulReplaces = 0;
    currentEtag = 'etag_initial_1';

    // Start with 8,000 tokens already used out of 10,000 limit -> 2,000 remaining
    const now = Date.now();
    const currentBucket = (Math.floor(now / 900000) * 900000).toString();

    sharedCosmosDoc = {
      id: 'active_budget',
      pk: 'global',
      budgetLimit: 10000,
      windowHours: 24,
      generation: 1,
      buckets: {
        [currentBucket]: 8000,
      },
      reservations: {},
      processedEvents: {},
      updatedAt: new Date().toISOString(),
      _etag: currentEtag,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenBudgetService,
        {
          provide: TokenBudgetRepository,
          useValue: mockRepo,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'AI_TOKEN_BUDGET_LIMIT') return 10000;
              if (key === 'AI_TOKEN_BUDGET_WINDOW_HOURS') return 24;
              if (key === 'AI_TOKEN_BUDGET_ENABLED') return 'true';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<TokenBudgetService>(TokenBudgetService);
  });

  it('Scenario 15 & 16: 15 concurrent requests compete for 2,000 remaining tokens without overspending', async () => {
    // 15 requests arrive concurrently, each requesting 1,000 tokens.
    // Budget limit = 10,000, existing usage = 8,000.
    // Exactly 2 requests must succeed (2 * 1,000 = 2,000).
    // The other 13 requests must be rejected.
    const concurrentRequests = Array.from({ length: 15 }, (_, i) =>
      service.reserveTokens({
        eventId: `evt_concurrent_${i + 1}`,
        stage: 'text_analyst',
        process: 'crew',
        model: 'gpt-5-mini',
        modelEnv: 'OPENAI_TEXT_MODEL',
        estimatedTokens: 1000,
      }),
    );

    const results = await Promise.all(concurrentRequests);

    const allowedCount = results.filter((r) => r.allowed).length;
    const rejectedCount = results.filter((r) => !r.allowed).length;

    expect(allowedCount).toBe(2);
    expect(rejectedCount).toBe(13);

    // Verify all rejected requests received budget exhausted reason
    for (const rejected of results.filter((r) => !r.allowed)) {
      expect(rejected.reason).toBe('AI_TOKEN_BUDGET_EXHAUSTED');
    }

    // Verify final state in Cosmos DB
    const finalSnapshot = await service.getSnapshot();
    const totalCommitted =
      finalSnapshot.currentUsage + finalSnapshot.currentReserved;

    expect(totalCommitted).toBe(10000); // 8,000 used + 2,000 reserved = 10,000 exactly
    expect(finalSnapshot.remainingBudget).toBe(0);
    expect(finalSnapshot.activeReservationCount).toBe(2);

    // ETag conflicts must have occurred and were safely handled
    expect(writeConflictCount).toBeGreaterThan(0);
  });

  it('Scenario 17: Concurrency conflict triggers fresh read and revalidation', async () => {
    // 2 requests compete for 1,500 tokens with 2,000 remaining
    const req1 = service.reserveTokens({
      stage: 'stage_1',
      process: 'crew',
      model: 'gpt-5.1',
      modelEnv: 'AGENT_CREW_MODEL',
      estimatedTokens: 1500,
    });
    const req2 = service.reserveTokens({
      stage: 'stage_2',
      process: 'crew',
      model: 'gpt-5.1',
      modelEnv: 'AGENT_CREW_MODEL',
      estimatedTokens: 1500,
    });

    const [res1, res2] = await Promise.all([req1, req2]);

    // One succeeds (1500 tokens), the second re-reads, sees only 500 remaining, and is rejected
    const successful = [res1, res2].filter((r) => r.allowed);
    const rejected = [res1, res2].filter((r) => !r.allowed);

    expect(successful.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toBe('AI_TOKEN_BUDGET_EXHAUSTED');
  });

  it('Scenario 18: Multi-stage workflow cannot bypass budget when subsequent calls exceed limit', async () => {
    // First stage succeeds with 1,200 tokens
    const stage1 = await service.reserveTokens({
      stage: 'text_moderation',
      process: 'lead_validator',
      model: 'gpt-5-mini',
      modelEnv: 'OPENAI_TEXT_MODEL',
      estimatedTokens: 1200,
    });
    expect(stage1.allowed).toBe(true);

    // Second stage attempts 1,000 tokens (8,000 + 1,200 + 1,000 = 10,200 > 10,000)
    const stage2 = await service.reserveTokens({
      stage: 'vision_analysis',
      process: 'lead_validator',
      model: 'gpt-5-mini',
      modelEnv: 'OPENAI_IMAGE_MODEL',
      estimatedTokens: 1000,
    });

    // Stage 2 must be independently blocked!
    expect(stage2.allowed).toBe(false);
    expect(stage2.reason).toBe('AI_TOKEN_BUDGET_EXHAUSTED');
  });

  it('Scenario 21: Reconciling actual usage after reservation releases unused tokens', async () => {
    const reservation = await service.reserveTokens({
      stage: 'intake',
      process: 'whatsapp_agent',
      model: 'gpt-5-mini',
      modelEnv: 'WHATSAPP_AGENT_LLM_MODEL',
      estimatedTokens: 1500,
    });
    expect(reservation.allowed).toBe(true);

    // Actual usage turned out to be only 600 tokens
    await service.reconcileUsage({
      reservationId: reservation.reservationId!,
      actualUsage: {
        inputTokens: 350,
        outputTokens: 250,
        totalTokens: 600,
      },
      success: true,
    });

    // 900 tokens (1500 - 600) were freed back
    const snapshot = await service.getSnapshot();
    expect(snapshot.currentUsage).toBe(8600); // 8,000 + 600
    expect(snapshot.currentReserved).toBe(0);
    expect(snapshot.remainingBudget).toBe(1400); // 10,000 - 8,600
  });
});
