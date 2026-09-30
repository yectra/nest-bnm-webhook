import { AiUsageTelemetryService } from './ai-usage-telemetry.service';

describe('AiUsageTelemetryService', () => {
  let service: AiUsageTelemetryService;

  beforeEach(() => {
    service = new AiUsageTelemetryService();
  });

  it('should capture actual API usage from responseUsage', () => {
    const record = service.recordUsage({
      requestId: 'req-1',
      stage: 'text',
      process: 'text_analysis',
      provider: 'azure-openai',
      model: 'gpt-5-mini',
      modelEnv: 'OPENAI_TEXT_MODEL',
      responseUsage: {
        prompt_tokens: 150,
        completion_tokens: 80,
        total_tokens: 230,
      },
      latencyMs: 420,
      success: true,
    });

    expect(record.inputTokens).toBe(150);
    expect(record.outputTokens).toBe(80);
    expect(record.totalTokens).toBe(230);
    expect(record.usageAvailable).toBe(true);
    expect(record.latencyMs).toBe(420);
    expect(record.success).toBe(true);

    const stepUsage = service.getStageUsage('req-1', 'text');
    expect(stepUsage).toBeDefined();
    expect(stepUsage?.inputTokens).toBe(150);
    expect(stepUsage?.outputTokens).toBe(80);
    expect(stepUsage?.totalTokens).toBe(230);
    expect(stepUsage?.usageAvailable).toBe(true);
  });

  it('should not fabricate zero tokens when usage is unavailable', () => {
    const record = service.recordUsage({
      requestId: 'req-2',
      stage: 'image',
      process: 'vision_analysis',
      provider: 'azure-openai',
      model: 'gpt-5-mini',
      modelEnv: 'OPENAI_IMAGE_MODEL',
      responseUsage: null,
      latencyMs: 700,
      usageAvailable: false,
      success: false,
      error: new Error('Image parsing failed'),
    });

    expect(record.inputTokens).toBeNull();
    expect(record.outputTokens).toBeNull();
    expect(record.totalTokens).toBeNull();
    expect(record.usageAvailable).toBe(false);
    expect(record.success).toBe(false);
    expect(record.error?.message).toBe('Image parsing failed');

    const stepUsage = service.getStageUsage('req-2', 'image');
    expect(stepUsage).toBeDefined();
    expect(stepUsage?.inputTokens).toBeNull();
    expect(stepUsage?.outputTokens).toBeNull();
    expect(stepUsage?.totalTokens).toBeNull();
    expect(stepUsage?.usageAvailable).toBe(false);
  });

  it('should aggregate summary across multiple stages and models accurately', () => {
    const reqId = 'ticket-full-run';

    // 1 text call
    service.recordUsage({
      requestId: reqId,
      stage: 'text',
      process: 'text_analysis',
      provider: 'azure-openai',
      model: 'gpt-5-mini',
      modelEnv: 'OPENAI_TEXT_MODEL',
      responseUsage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      latencyMs: 300,
      success: true,
    });

    // 1 image call
    service.recordUsage({
      requestId: reqId,
      stage: 'image',
      process: 'vision_analysis',
      provider: 'azure-openai',
      model: 'gpt-5-mini',
      modelEnv: 'OPENAI_IMAGE_MODEL',
      responseUsage: { prompt_tokens: 200, completion_tokens: 75, total_tokens: 275 },
      latencyMs: 600,
      success: true,
    });

    // 1 evaluation call
    service.recordUsage({
      requestId: reqId,
      stage: 'evaluation',
      process: 'final_evaluation',
      provider: 'azure-openai',
      model: 'gpt-5-mini',
      modelEnv: 'OPENAI_EVALUATION_MODEL',
      responseUsage: { prompt_tokens: 300, completion_tokens: 125, total_tokens: 425 },
      latencyMs: 900,
      success: true,
    });

    const summary = service.getSummaryReport(reqId);

    expect(summary.totalCalls).toBe(3);
    expect(summary.totalInputTokens).toBe(100 + 200 + 300);
    expect(summary.totalOutputTokens).toBe(50 + 75 + 125);
    expect(summary.totalTokens).toBe(150 + 275 + 425);
    expect(summary.totalLatencyMs).toBe(300 + 600 + 900);

    // Verify stage totals
    expect(summary.byStage.text.calls).toBe(1);
    expect(summary.byStage.text.inputTokens).toBe(100);
    expect(summary.byStage.text.outputTokens).toBe(50);
    expect(summary.byStage.text.totalTokens).toBe(150);
    expect(summary.byStage.text.latencyMs).toBe(300);

    expect(summary.byStage.image.calls).toBe(1);
    expect(summary.byStage.image.inputTokens).toBe(200);
    expect(summary.byStage.image.outputTokens).toBe(75);
    expect(summary.byStage.image.totalTokens).toBe(275);
    expect(summary.byStage.image.latencyMs).toBe(600);

    expect(summary.byStage.evaluation.calls).toBe(1);
    expect(summary.byStage.evaluation.inputTokens).toBe(300);
    expect(summary.byStage.evaluation.outputTokens).toBe(125);
    expect(summary.byStage.evaluation.totalTokens).toBe(425);
    expect(summary.byStage.evaluation.latencyMs).toBe(900);

    // Verify model totals
    expect(summary.byModel['gpt-5-mini'].calls).toBe(3);
    expect(summary.byModel['gpt-5-mini'].inputTokens).toBe(600);
    expect(summary.byModel['gpt-5-mini'].outputTokens).toBe(250);
    expect(summary.byModel['gpt-5-mini'].totalTokens).toBe(850);
    expect(summary.byModel['gpt-5-mini'].latencyMs).toBe(1800);
  });
});
