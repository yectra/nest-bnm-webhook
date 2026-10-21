import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { TokenBudgetRepository } from './token-budget.repository';
import {
  ActiveBudgetDocument,
  BudgetStateSnapshot,
  LedgerEntry,
  ReconciliationParams,
  ReconciliationResult,
  ReservationResult,
  ResetAuditEntry,
  ResetResult,
  TokenReservation,
} from './token-budget.types';

const BUCKET_DURATION_MS = 15 * 60 * 1000; // 15-minute rolling granularity
const DEFAULT_RESERVATION_TTL_MS = 3 * 60 * 1000; // 3-minute TTL for in-flight reservations
const MAX_CONCURRENCY_RETRIES = 5;

@Injectable()
export class TokenBudgetService {
  private readonly logger = new Logger(TokenBudgetService.name);

  constructor(
    private readonly repository: TokenBudgetRepository,
    private readonly configService: ConfigService,
  ) {}

  public isEnabled(): boolean {
    const val = this.configService.get<string>('AI_TOKEN_BUDGET_ENABLED');
    if (val === undefined || val === null || val === '') {
      return true; // enabled by default
    }
    return val === 'true' || val === '1';
  }

  public getLimit(): number {
    const raw = this.configService.get<string | number>(
      'AI_TOKEN_BUDGET_LIMIT',
    );
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10000;
  }

  public getWindowHours(): number {
    const raw = this.configService.get<string | number>(
      'AI_TOKEN_BUDGET_WINDOW_HOURS',
    );
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
  }

  private getCurrentBucketKey(timestamp = Date.now()): string {
    const bucketStart =
      Math.floor(timestamp / BUCKET_DURATION_MS) * BUCKET_DURATION_MS;
    return bucketStart.toString();
  }

  /**
   * Cleans up expired buckets older than rolling window and expired reservations.
   * Modifies doc in-place and returns { currentUsage, currentReserved, expiredReservationsCount }.
   */
  private pruneAndCalculateState(
    doc: ActiveBudgetDocument,
    windowHours: number,
    now = Date.now(),
  ): {
    currentUsage: number;
    currentReserved: number;
    prunedBucketsCount: number;
    prunedReservationsCount: number;
  } {
    const windowStartMs = now - windowHours * 60 * 60 * 1000;

    // 1. Prune expired time buckets
    let currentUsage = 0;
    let prunedBucketsCount = 0;
    if (doc.buckets) {
      for (const [bucketKey, tokens] of Object.entries(doc.buckets)) {
        const bucketTime = Number(bucketKey);
        if (bucketTime + BUCKET_DURATION_MS < windowStartMs) {
          delete doc.buckets[bucketKey];
          prunedBucketsCount++;
        } else {
          currentUsage += tokens;
        }
      }
    } else {
      doc.buckets = {};
    }

    // 2. Prune expired/abandoned reservations (auto-recovery)
    let currentReserved = 0;
    let prunedReservationsCount = 0;
    if (doc.reservations) {
      for (const [resId, res] of Object.entries(doc.reservations)) {
        if (res.expiresAt && res.expiresAt < now) {
          delete doc.reservations[resId];
          prunedReservationsCount++;
          this.logger.warn(
            `Recovered abandoned reservation ${resId} (${res.reservedTokens} tokens, expired at ${new Date(
              res.expiresAt,
            ).toISOString()})`,
          );
        } else {
          currentReserved += res.reservedTokens;
        }
      }
    } else {
      doc.reservations = {};
    }

    // 3. Prune old processed events (older than 24h)
    if (doc.processedEvents) {
      for (const [evtId, evt] of Object.entries(doc.processedEvents)) {
        if (evt.timestamp < windowStartMs) {
          delete doc.processedEvents[evtId];
        }
      }
    } else {
      doc.processedEvents = {};
    }

    return {
      currentUsage,
      currentReserved,
      prunedBucketsCount,
      prunedReservationsCount,
    };
  }

  /**
   * Fast budget check to see if an incoming event can be accommodated.
   */
  async checkBudgetAvailable(
    estimatedTokens = 500,
  ): Promise<ReservationResult> {
    if (!this.isEnabled()) {
      return {
        allowed: true,
        currentUsage: 0,
        currentReserved: 0,
        remainingTokens: Infinity,
        limit: this.getLimit(),
        windowStart: new Date(
          Date.now() - this.getWindowHours() * 3600000,
        ).toISOString(),
        windowEnd: new Date().toISOString(),
      };
    }

    const limit = this.getLimit();
    const windowHours = this.getWindowHours();
    const now = Date.now();
    const windowStart = new Date(now - windowHours * 3600000).toISOString();
    const windowEnd = new Date(now).toISOString();

    try {
      const doc = await this.repository.getActiveBudget(limit, windowHours);
      const { currentUsage, currentReserved } = this.pruneAndCalculateState(
        doc,
        windowHours,
        now,
      );
      const remainingTokens = Math.max(
        0,
        limit - (currentUsage + currentReserved),
      );

      if (currentUsage + currentReserved + estimatedTokens > limit) {
        this.logger.warn(
          `AI_TOKEN_BUDGET_EXHAUSTED: rolling 24-hour token limit reached; currentUsage=${currentUsage}, reserved=${currentReserved}, limit=${limit}; remaining=${remainingTokens}`,
        );
        return {
          allowed: false,
          reason: 'AI_TOKEN_BUDGET_EXHAUSTED',
          currentUsage,
          currentReserved,
          remainingTokens,
          limit,
          windowStart,
          windowEnd,
        };
      }

      return {
        allowed: true,
        currentUsage,
        currentReserved,
        remainingTokens,
        limit,
        windowStart,
        windowEnd,
      };
    } catch (err: unknown) {
      const error = err as { message?: string; stack?: string };
      this.logger.error(
        `Failed to check budget availability: ${error.message || String(err)}. Failing closed for AI processing.`,
        error.stack,
      );
      return {
        allowed: false,
        reason: 'AI_BUDGET_CHECK_ERROR',
        currentUsage: limit,
        currentReserved: 0,
        remainingTokens: 0,
        limit,
        windowStart,
        windowEnd,
      };
    }
  }

  /**
   * Reserves tokens in Cosmos DB before invoking an AI model call.
   * Concurrency-safe: uses optimistic concurrency (ETag) with bounded retries.
   */
  async reserveTokens(params: {
    eventId?: string;
    stage: string;
    process: string;
    model: string;
    modelEnv: string;
    estimatedTokens: number;
    ttlMs?: number;
  }): Promise<ReservationResult> {
    if (!this.isEnabled()) {
      return {
        allowed: true,
        reservationId: `disabled_${randomUUID()}`,
        currentUsage: 0,
        currentReserved: 0,
        remainingTokens: Infinity,
        limit: this.getLimit(),
        windowStart: new Date().toISOString(),
        windowEnd: new Date().toISOString(),
      };
    }

    const limit = this.getLimit();
    const windowHours = this.getWindowHours();
    const reservationId = `res_${randomUUID()}`;
    const ttlMs = params.ttlMs ?? DEFAULT_RESERVATION_TTL_MS;

    for (let attempt = 1; attempt <= MAX_CONCURRENCY_RETRIES; attempt++) {
      const now = Date.now();
      const windowStart = new Date(now - windowHours * 3600000).toISOString();
      const windowEnd = new Date(now).toISOString();

      try {
        const doc = await this.repository.getActiveBudget(limit, windowHours);
        const { currentUsage, currentReserved } = this.pruneAndCalculateState(
          doc,
          windowHours,
          now,
        );

        const totalCommitted = currentUsage + currentReserved;
        const remainingTokens = Math.max(0, limit - totalCommitted);

        // Check if requested reservation fits into remaining budget
        if (totalCommitted + params.estimatedTokens > limit) {
          this.logger.warn(
            `AI_TOKEN_RESERVATION_REJECTED: insufficient remaining budget; AI processing skipped. EventId=${params.eventId ?? 'none'}, stage=${params.stage}, model=${params.model}, estimated=${params.estimatedTokens}, currentUsage=${currentUsage}, reserved=${currentReserved}, limit=${limit}`,
          );
          return {
            allowed: false,
            reason: 'AI_TOKEN_BUDGET_EXHAUSTED',
            currentUsage,
            currentReserved,
            remainingTokens,
            limit,
            windowStart,
            windowEnd,
          };
        }

        // Create reservation object
        const newReservation: TokenReservation = {
          id: reservationId,
          eventId: params.eventId,
          stage: params.stage,
          process: params.process,
          model: params.model,
          modelEnv: params.modelEnv,
          reservedTokens: params.estimatedTokens,
          createdAt: now,
          expiresAt: now + ttlMs,
        };

        doc.reservations[reservationId] = newReservation;

        // Conditional replace with ETag
        await this.repository.replaceActiveBudget(doc, doc._etag);

        this.logger.log(
          `AI_TOKEN_RESERVATION_CREATED: reserved ${params.estimatedTokens} tokens for stage "${params.stage}" (${params.model}). ReservationId: ${reservationId}. Current usage: ${currentUsage}, reserved: ${currentReserved + params.estimatedTokens}/${limit}`,
        );

        return {
          allowed: true,
          reservationId,
          currentUsage,
          currentReserved: currentReserved + params.estimatedTokens,
          remainingTokens: remainingTokens - params.estimatedTokens,
          limit,
          windowStart,
          windowEnd,
        };
      } catch (err: unknown) {
        const error = err as {
          statusCode?: number;
          code?: number;
          message?: string;
          stack?: string;
        };
        // HTTP 412: Precondition Failed (ETag conflict)
        if (error.statusCode === 412 || error.code === 412) {
          this.logger.warn(
            `Concurrency conflict on budget reservation (attempt ${attempt}/${MAX_CONCURRENCY_RETRIES}). Backing off and retrying with fresh state.`,
          );
          // Exponential backoff with jitter (20ms to ~300ms)
          const delay = Math.floor(
            Math.pow(2, attempt) * 15 + Math.random() * 25,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        this.logger.error(
          `AI_TOKEN_RESERVATION_FAILED: database error during reservation attempt: ${error.message || String(err)}`,
          error.stack,
        );
        return {
          allowed: false,
          reason: 'DATABASE_ERROR',
          currentUsage: limit,
          currentReserved: 0,
          remainingTokens: 0,
          limit,
          windowStart: new Date().toISOString(),
          windowEnd: new Date().toISOString(),
        };
      }
    }

    this.logger.error(
      `AI_TOKEN_RESERVATION_REJECTED: concurrency retries exhausted after ${MAX_CONCURRENCY_RETRIES} attempts. Request rejected.`,
    );
    return {
      allowed: false,
      reason: 'AI_TOKEN_CONCURRENCY_EXHAUSTED',
      currentUsage: limit,
      currentReserved: 0,
      remainingTokens: 0,
      limit,
      windowStart: new Date().toISOString(),
      windowEnd: new Date().toISOString(),
    };
  }

  /**
   * Reconciles actual token usage after an AI model call completes.
   * Atomically transfers reserved tokens into actual usage in the current 15-minute bucket,
   * releases any unused reservation, records overrun if applicable, and writes a ledger entry.
   */
  async reconcileUsage(
    params: ReconciliationParams,
  ): Promise<ReconciliationResult> {
    if (!this.isEnabled() || params.reservationId.startsWith('disabled_')) {
      return {
        success: true,
        callId: params.reservationId,
        actualTokens: params.actualUsage.totalTokens,
        reservedTokens: 0,
        overrunTokens: 0,
        freedTokens: 0,
        generation: 1,
      };
    }

    const limit = this.getLimit();
    const windowHours = this.getWindowHours();
    const actualTokens = params.actualUsage.totalTokens;

    for (let attempt = 1; attempt <= MAX_CONCURRENCY_RETRIES; attempt++) {
      const now = Date.now();
      const currentBucketKey = this.getCurrentBucketKey(now);

      try {
        const doc = await this.repository.getActiveBudget(limit, windowHours);
        this.pruneAndCalculateState(doc, windowHours, now);

        const reservation = doc.reservations[params.reservationId];
        const reservedTokens = reservation ? reservation.reservedTokens : 0;
        const overrunTokens = Math.max(0, actualTokens - reservedTokens);
        const freedTokens = Math.max(0, reservedTokens - actualTokens);

        // Add actual tokens to current 15-min bucket
        doc.buckets[currentBucketKey] =
          (doc.buckets[currentBucketKey] || 0) + actualTokens;

        // Remove the reservation
        delete doc.reservations[params.reservationId];

        // Conditional replace with ETag
        await this.repository.replaceActiveBudget(doc, doc._etag);

        if (overrunTokens > 0) {
          this.logger.error(
            `AI_TOKEN_USAGE_RECONCILIATION_OVERRUN: actual tokens (${actualTokens}) exceeded reservation (${reservedTokens}) by ${overrunTokens} tokens! Model: ${reservation?.model || 'unknown'}, Stage: ${reservation?.stage || 'unknown'}`,
          );
        } else {
          this.logger.log(
            `AI_TOKEN_USAGE_RECONCILED: actual=${actualTokens}, reserved=${reservedTokens}, freed=${freedTokens}. ReservationId: ${params.reservationId}`,
          );
        }

        // Asynchronously persist ledger entry for audit and Azure AI Foundry comparison
        const ledgerEntry: LedgerEntry = {
          id: `ledger_${params.reservationId}`,
          pk: 'global',
          type: 'LEDGER_ENTRY',
          reservationId: params.reservationId,
          eventId: reservation?.eventId,
          stage: reservation?.stage || 'unknown',
          process: reservation?.process || 'unknown',
          model: reservation?.model || 'unknown',
          modelEnv: reservation?.modelEnv || 'unknown',
          reservedTokens,
          inputTokens: params.actualUsage.inputTokens,
          outputTokens: params.actualUsage.outputTokens,
          totalTokens: actualTokens,
          overrunTokens,
          generation: doc.generation,
          success: params.success,
          error: params.error
            ? params.error instanceof Error
              ? params.error.message
              : typeof params.error === 'string'
                ? params.error
                : JSON.stringify(params.error)
            : undefined,
          timestamp: new Date().toISOString(),
        };

        // Fire-and-forget ledger write
        this.repository.writeLedgerEntry(ledgerEntry).catch((err: unknown) => {
          const errObj = err as { message?: string };
          this.logger.error(
            `Failed to write ledger record: ${errObj.message || String(err)}`,
          );
        });

        return {
          success: true,
          callId: params.reservationId,
          actualTokens,
          reservedTokens,
          overrunTokens,
          freedTokens,
          generation: doc.generation,
        };
      } catch (err: unknown) {
        const error = err as {
          statusCode?: number;
          code?: number;
          message?: string;
          stack?: string;
        };
        if (error.statusCode === 412 || error.code === 412) {
          this.logger.warn(
            `Concurrency conflict on usage reconciliation (attempt ${attempt}/${MAX_CONCURRENCY_RETRIES}). Backing off and retrying.`,
          );
          const delay = Math.floor(
            Math.pow(2, attempt) * 15 + Math.random() * 25,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        this.logger.error(
          `AI_TOKEN_USAGE_RECONCILIATION_FAILED: error during reconciliation for reservation ${params.reservationId}: ${error.message || String(err)}`,
          error.stack,
        );
        return {
          success: false,
          callId: params.reservationId,
          actualTokens,
          reservedTokens: 0,
          overrunTokens: 0,
          freedTokens: 0,
          generation: 0,
        };
      }
    }

    this.logger.error(
      `AI_TOKEN_USAGE_RECONCILIATION_FAILED: retries exhausted for reservation ${params.reservationId}.`,
    );
    return {
      success: false,
      callId: params.reservationId,
      actualTokens,
      reservedTokens: 0,
      overrunTokens: 0,
      freedTokens: 0,
      generation: 0,
    };
  }

  /**
   * Retrieves a snapshot of the current budget status for telemetry, logs, or CLI inspection.
   */
  async getSnapshot(): Promise<BudgetStateSnapshot> {
    const limit = this.getLimit();
    const windowHours = this.getWindowHours();
    const enabled = this.isEnabled();
    const now = Date.now();
    const windowStart = new Date(now - windowHours * 3600000).toISOString();
    const windowEnd = new Date(now).toISOString();

    try {
      const doc = await this.repository.getActiveBudget(limit, windowHours);
      const { currentUsage, currentReserved } = this.pruneAndCalculateState(
        doc,
        windowHours,
        now,
      );

      return {
        enabled,
        limit,
        windowHours,
        generation: doc.generation,
        currentUsage,
        currentReserved,
        remainingBudget: Math.max(0, limit - (currentUsage + currentReserved)),
        activeReservationCount: Object.keys(doc.reservations).length,
        windowStart,
        windowEnd,
      };
    } catch (err: unknown) {
      const error = err as { message?: string };
      this.logger.error(
        `Error fetching budget snapshot: ${error.message || String(err)}`,
      );
      return {
        enabled,
        limit,
        windowHours,
        generation: 0,
        currentUsage: 0,
        currentReserved: 0,
        remainingBudget: 0,
        activeReservationCount: 0,
        windowStart,
        windowEnd,
      };
    }
  }

  /**
   * Manually resets the budget for local/development testing.
   * Safety rules:
   * - Must be explicitly confirmed.
   * - AI_TOKEN_BUDGET_MANUAL_RESET_ENABLED must be 'true'.
   * - Blocked in production.
   * - Refuses to reset if unexpired active reservations exist, unless force=true.
   * - Records a ResetAuditEntry in Cosmos DB.
   * - Starts a new generation/epoch instead of deleting documents.
   */
  async manualReset(options: {
    confirm: boolean;
    triggeredBy?: string;
    force?: boolean;
  }): Promise<ResetResult> {
    const isResetEnabled =
      this.configService.get<string>('AI_TOKEN_BUDGET_MANUAL_RESET_ENABLED') ===
      'true';

    if (!isResetEnabled) {
      throw new Error(
        'Manual reset is disabled. Set AI_TOKEN_BUDGET_MANUAL_RESET_ENABLED=true in local development to enable.',
      );
    }

    const nodeEnv = this.configService.get<string>('NODE_ENV') || 'development';
    if (nodeEnv.toLowerCase() === 'production') {
      throw new Error(
        'Manual reset is strictly forbidden in production environments.',
      );
    }

    if (!options.confirm) {
      throw new Error(
        'Explicit confirmation is required to reset the token budget (--confirm).',
      );
    }

    const limit = this.getLimit();
    const windowHours = this.getWindowHours();

    for (let attempt = 1; attempt <= MAX_CONCURRENCY_RETRIES; attempt++) {
      const now = Date.now();
      const doc = await this.repository.getActiveBudget(limit, windowHours);
      const { currentUsage, currentReserved } = this.pruneAndCalculateState(
        doc,
        windowHours,
        now,
      );

      const activeReservationsCount = Object.keys(doc.reservations).length;
      if (activeReservationsCount > 0 && !options.force) {
        throw new Error(
          `Cannot reset budget: there are ${activeReservationsCount} active, unexpired reservations (${currentReserved} tokens). Wait for them to finish or specify force.`,
        );
      }

      const prevGen = doc.generation;
      const newGen = prevGen + 1;
      const prevUsage = currentUsage;

      // Reset state for new generation
      doc.generation = newGen;
      doc.buckets = {};
      doc.reservations = {};
      doc.processedEvents = {};

      try {
        await this.repository.replaceActiveBudget(doc, doc._etag);

        // Record reset audit entry
        const auditRecordId = `reset_${now}`;
        const auditEntry: ResetAuditEntry = {
          id: auditRecordId,
          pk: 'global',
          type: 'RESET_EVENT',
          previousGeneration: prevGen,
          newGeneration: newGen,
          previousUsage: prevUsage,
          clearedReservationsCount: activeReservationsCount,
          timestamp: new Date().toISOString(),
          triggeredBy: options.triggeredBy || 'cli-manual-reset',
        };

        await this.repository.writeResetAuditEntry(auditEntry);

        this.logger.log(
          `AI_BUDGET_RESET_SUCCESS: budget reset from generation ${prevGen} to ${newGen}. Previous usage was ${prevUsage} tokens. Audit ID: ${auditRecordId}`,
        );

        return {
          success: true,
          previousGeneration: prevGen,
          newGeneration: newGen,
          previousUsage: prevUsage,
          clearedReservationsCount: activeReservationsCount,
          timestamp: new Date().toISOString(),
          auditRecordId,
        };
      } catch (err: unknown) {
        const error = err as { statusCode?: number; code?: number };
        if (error.statusCode === 412 || error.code === 412) {
          const delay = Math.floor(Math.pow(2, attempt) * 20);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }

    throw new Error(
      'Failed to reset budget: concurrency conflict retries exhausted.',
    );
  }
}
