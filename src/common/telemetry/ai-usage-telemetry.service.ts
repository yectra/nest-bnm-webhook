import { Injectable, Logger } from '@nestjs/common';

export interface AiUsageRecord {
  event: 'ai_usage';
  requestId: string;
  timestamp: string;
  stage: string;
  process: string;
  provider: string;
  model: string;
  modelEnv: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  usageAvailable: boolean;
  success: boolean;
  callIndex?: number;
  error?: {
    name: string;
    code?: string;
    message: string;
  } | null;
}

export interface AiStepUsageInfo {
  stage: string;
  process: string;
  provider: string;
  model: string;
  modelEnv: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  usageAvailable: boolean;
  success: boolean;
}

export interface StageUsageDetail {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  totalLatencyMs: number;
}

export interface ModelUsageDetail {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  totalLatencyMs: number;
}

export interface AiUsageSummaryReport {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalLatencyMs: number;
  byStage: Record<string, StageUsageDetail>;
  byModel: Record<string, ModelUsageDetail>;
}

export interface StageUsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ModelUsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AiRequestUsageSummary {
  event: 'ai_usage_summary';
  requestId: string;
  timestamp: string;
  stages: Record<string, StageUsageSummary>;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalLatencyMs: number;
}

export interface AiModelUsageSummary {
  event: 'ai_model_usage_summary';
  requestId: string;
  timestamp: string;
  models: Record<string, ModelUsageSummary>;
}

export interface RecordUsageParams {
  requestId?: string;
  stage: string;
  process: string;
  provider?: string;
  model: string;
  modelEnv: string;
  responseUsage?: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
  } | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  latencyMs: number;
  usageAvailable?: boolean;
  success: boolean;
  callIndex?: number;
  error?: unknown;
}

@Injectable()
export class AiUsageTelemetryService {
  private readonly logger = new Logger(AiUsageTelemetryService.name);
  private readonly requestRecords = new Map<string, AiUsageRecord[]>();
  private readonly recordTimestamps = new Map<string, number>();

  /** Record a single AI invocation and log it as structured JSON */
  recordUsage(params: RecordUsageParams): AiUsageRecord {
    const requestId =
      params.requestId && params.requestId.trim().length > 0
        ? params.requestId.trim()
        : `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const provider = params.provider || 'azure-openai';

    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let totalTokens: number | null = null;

    if (params.responseUsage) {
      inputTokens =
        typeof params.responseUsage.prompt_tokens === 'number'
          ? params.responseUsage.prompt_tokens
          : null;
      outputTokens =
        typeof params.responseUsage.completion_tokens === 'number'
          ? params.responseUsage.completion_tokens
          : null;
      totalTokens =
        typeof params.responseUsage.total_tokens === 'number'
          ? params.responseUsage.total_tokens
          : inputTokens != null && outputTokens != null
            ? inputTokens + outputTokens
            : null;
    } else {
      inputTokens =
        typeof params.inputTokens === 'number' ? params.inputTokens : null;
      outputTokens =
        typeof params.outputTokens === 'number' ? params.outputTokens : null;
      totalTokens =
        typeof params.totalTokens === 'number'
          ? params.totalTokens
          : inputTokens != null && outputTokens != null
            ? inputTokens + outputTokens
            : null;
    }

    const usageAvailable =
      typeof params.usageAvailable === 'boolean'
        ? params.usageAvailable
        : inputTokens != null || outputTokens != null || totalTokens != null;

    let formattedError: AiUsageRecord['error'] = null;
    if (params.error) {
      if (params.error instanceof Error) {
        formattedError = {
          name: params.error.name || 'Error',
          message: params.error.message || String(params.error),
          code: (params.error as any).code
            ? String((params.error as any).code)
            : undefined,
        };
      } else if (typeof params.error === 'object') {
        const errObj = params.error as Record<string, unknown>;
        formattedError = {
          name: String(errObj.name || 'Error'),
          message: String(errObj.message || JSON.stringify(params.error)),
          code: errObj.code ? String(errObj.code) : undefined,
        };
      } else {
        formattedError = {
          name: 'Error',
          message: String(params.error),
        };
      }
    }

    const record: AiUsageRecord = {
      event: 'ai_usage',
      requestId,
      timestamp: new Date().toISOString(),
      stage: params.stage,
      process: params.process,
      provider,
      model: params.model || 'UNKNOWN_MODEL',
      modelEnv: params.modelEnv || 'UNKNOWN_ENV',
      inputTokens,
      outputTokens,
      totalTokens,
      latencyMs: Math.max(0, Math.round(params.latencyMs)),
      usageAvailable,
      success: params.success,
      callIndex: params.callIndex,
      error: formattedError,
    };

    // Output machine-readable JSON log
    this.logger.log(JSON.stringify(record));

    // Store in request tracker for summary aggregation
    if (!this.requestRecords.has(requestId)) {
      this.requestRecords.set(requestId, []);
      this.recordTimestamps.set(requestId, Date.now());
    }
    this.requestRecords.get(requestId)!.push(record);

    // Evict stale requests older than 15 minutes to prevent memory leaks
    this.pruneStaleRecords();

    return record;
  }

  /** Retrieve aggregated step AI usage info for a specific stage */
  getStageUsage(requestId: string, stage: string): AiStepUsageInfo | null {
    const records = (this.requestRecords.get(requestId) || []).filter(
      (r) => r.stage === stage,
    );
    if (records.length === 0) {
      return null;
    }
    const hasInputTokens = records.some(
      (r) => typeof r.inputTokens === 'number',
    );
    const hasOutputTokens = records.some(
      (r) => typeof r.outputTokens === 'number',
    );
    const hasTotalTokens = records.some(
      (r) => typeof r.totalTokens === 'number',
    );

    const inputTokens = hasInputTokens
      ? records.reduce((sum, r) => sum + (r.inputTokens || 0), 0)
      : null;
    const outputTokens = hasOutputTokens
      ? records.reduce((sum, r) => sum + (r.outputTokens || 0), 0)
      : null;
    const totalTokens = hasTotalTokens
      ? records.reduce((sum, r) => sum + (r.totalTokens || 0), 0)
      : inputTokens !== null && outputTokens !== null
        ? inputTokens + outputTokens
        : null;

    const latencyMs = records.reduce((sum, r) => sum + (r.latencyMs || 0), 0);
    const usageAvailable = records.some((r) => r.usageAvailable);

    return {
      stage,
      process: records[0].process,
      provider: records[0].provider,
      model: records[0].model,
      modelEnv: records[0].modelEnv,
      inputTokens,
      outputTokens,
      totalTokens,
      latencyMs,
      usageAvailable,
      success: records.every((r) => r.success),
    };
  }

  /** Retrieve full structured AI usage summary report for a request */
  getSummaryReport(requestId: string): AiUsageSummaryReport {
    const records = this.requestRecords.get(requestId) || [];
    const byStage: Record<string, StageUsageDetail> = {};
    const byModel: Record<string, ModelUsageDetail> = {};

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokens = 0;
    let totalLatencyMs = 0;

    for (const r of records) {
      const inTok = r.inputTokens ?? 0;
      const outTok = r.outputTokens ?? 0;
      const totTok = r.totalTokens ?? inTok + outTok;

      if (!byStage[r.stage]) {
        byStage[r.stage] = {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          latencyMs: 0,
          totalLatencyMs: 0,
        };
      }
      byStage[r.stage].calls += 1;
      byStage[r.stage].inputTokens += inTok;
      byStage[r.stage].outputTokens += outTok;
      byStage[r.stage].totalTokens += totTok;
      byStage[r.stage].latencyMs += r.latencyMs;
      byStage[r.stage].totalLatencyMs += r.latencyMs;

      if (!byModel[r.model]) {
        byModel[r.model] = {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          latencyMs: 0,
          totalLatencyMs: 0,
        };
      }
      byModel[r.model].calls += 1;
      byModel[r.model].inputTokens += inTok;
      byModel[r.model].outputTokens += outTok;
      byModel[r.model].totalTokens += totTok;
      byModel[r.model].latencyMs += r.latencyMs;
      byModel[r.model].totalLatencyMs += r.latencyMs;

      totalInputTokens += inTok;
      totalOutputTokens += outTok;
      totalTokens += totTok;
      totalLatencyMs += r.latencyMs;
    }

    return {
      totalCalls: records.length,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      totalLatencyMs,
      byStage,
      byModel,
    };
  }

  /** Compute and emit final request-level and model-level summaries for a given requestId */
  emitSummary(
    requestId: string,
  ): {
    requestSummary: AiRequestUsageSummary;
    modelSummary: AiModelUsageSummary;
  } | null {
    const records = this.requestRecords.get(requestId);
    if (!records || records.length === 0) {
      return null;
    }

    const stages: Record<string, StageUsageSummary> = {};
    const models: Record<string, ModelUsageSummary> = {};

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokens = 0;
    let totalLatencyMs = 0;

    for (const rec of records) {
      const inTok = rec.inputTokens ?? 0;
      const outTok = rec.outputTokens ?? 0;
      const totTok = rec.totalTokens ?? inTok + outTok;

      // Stage aggregation
      if (!stages[rec.stage]) {
        stages[rec.stage] = {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        };
      }
      stages[rec.stage].calls += 1;
      stages[rec.stage].inputTokens += inTok;
      stages[rec.stage].outputTokens += outTok;
      stages[rec.stage].totalTokens += totTok;

      // Model aggregation
      if (!models[rec.model]) {
        models[rec.model] = {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        };
      }
      models[rec.model].calls += 1;
      models[rec.model].inputTokens += inTok;
      models[rec.model].outputTokens += outTok;
      models[rec.model].totalTokens += totTok;

      totalInputTokens += inTok;
      totalOutputTokens += outTok;
      totalTokens += totTok;
      totalLatencyMs += rec.latencyMs;
    }

    const requestSummary: AiRequestUsageSummary = {
      event: 'ai_usage_summary',
      requestId,
      timestamp: new Date().toISOString(),
      stages,
      totalCalls: records.length,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      totalLatencyMs,
    };

    const modelSummary: AiModelUsageSummary = {
      event: 'ai_model_usage_summary',
      requestId,
      timestamp: new Date().toISOString(),
      models,
    };

    // Emit JSON logs
    this.logger.log(JSON.stringify(requestSummary));
    this.logger.log(JSON.stringify(modelSummary));

    // Clear buffer for this request
    this.requestRecords.delete(requestId);
    this.recordTimestamps.delete(requestId);

    return { requestSummary, modelSummary };
  }

  private pruneStaleRecords(): void {
    const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
    for (const [reqId, ts] of this.recordTimestamps.entries()) {
      if (ts < fifteenMinutesAgo) {
        this.requestRecords.delete(reqId);
        this.recordTimestamps.delete(reqId);
      }
    }
  }
}
