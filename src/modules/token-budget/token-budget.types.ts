export type SenderPolicyMode = 'allowlist' | 'all';

export interface TokenReservation {
  id: string; // unique reservation / call ID
  eventId?: string;
  stage: string;
  process: string;
  model: string;
  modelEnv: string;
  reservedTokens: number;
  createdAt: number; // Unix timestamp ms
  expiresAt: number; // Unix timestamp ms
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TimeBucketUsage {
  [bucketKey: string]: number; // bucketKey format: ISO timestamp string (e.g. 15-min bucket)
}

export interface ActiveBudgetDocument {
  id: string; // 'active_budget'
  pk: string; // 'global'
  budgetLimit: number;
  windowHours: number;
  generation: number; // incremented on reset
  buckets: TimeBucketUsage;
  reservations: Record<string, TokenReservation>;
  processedEvents?: Record<
    string,
    {
      status: 'processing' | 'completed' | 'skipped';
      reason?: string;
      timestamp: number;
    }
  >;
  updatedAt: string;
  _etag?: string;
}

export interface ReservationResult {
  allowed: boolean;
  reservationId?: string;
  reason?: string;
  currentUsage: number;
  currentReserved: number;
  remainingTokens: number;
  limit: number;
  windowStart: string;
  windowEnd: string;
}

export interface ReconciliationParams {
  reservationId: string;
  actualUsage: TokenUsage;
  success: boolean;
  error?: unknown;
}

export interface ReconciliationResult {
  success: boolean;
  callId: string;
  actualTokens: number;
  reservedTokens: number;
  overrunTokens: number;
  freedTokens: number;
  generation: number;
}

export interface BudgetStateSnapshot {
  enabled: boolean;
  limit: number;
  windowHours: number;
  generation: number;
  currentUsage: number;
  currentReserved: number;
  remainingBudget: number;
  activeReservationCount: number;
  windowStart: string;
  windowEnd: string;
}

export interface ResetResult {
  success: boolean;
  previousGeneration: number;
  newGeneration: number;
  previousUsage: number;
  clearedReservationsCount: number;
  timestamp: string;
  auditRecordId: string;
}

export interface LedgerEntry {
  id: string; // 'ledger_' + callId
  pk: string; // 'global'
  type: 'LEDGER_ENTRY';
  reservationId: string;
  eventId?: string;
  stage: string;
  process: string;
  model: string;
  modelEnv: string;
  reservedTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  overrunTokens: number;
  generation: number;
  success: boolean;
  error?: string;
  timestamp: string;
}

export interface ResetAuditEntry {
  id: string; // 'reset_' + timestamp
  pk: string; // 'global'
  type: 'RESET_EVENT';
  previousGeneration: number;
  newGeneration: number;
  previousUsage: number;
  clearedReservationsCount: number;
  timestamp: string;
  triggeredBy: string;
}
