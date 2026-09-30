import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { AiUsageTelemetryService } from '../../../common/telemetry/ai-usage-telemetry.service';

export interface TelemetryOptions {
  requestId?: string;
  stage: string;
  process: string;
  modelEnv: string;
  provider?: string;
  callIndex?: number;
}

/**
 * Thin wrapper around the Azure AI Foundry OpenAI v1 endpoint for the crew's
 * GPT-5 deployment. GPT-5 is a reasoning model, so no temperature override is
 * sent and vision requests use the standard multi-part content format.
 */
@Injectable()
export class CrewLlmProvider {
  private readonly logger = new Logger(CrewLlmProvider.name);
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly textModel: string;
  private readonly imageModel: string;
  private readonly evaluationModel: string;

  constructor(
    config: ConfigService,
    @Optional() private readonly telemetryService?: AiUsageTelemetryService,
  ) {
    const agentCrewModel =
      config.get<string>('AGENT_CREW_MODEL') ||
      config.get<string>('azure.agentCrewModel');
    if (!agentCrewModel) {
      throw new Error('AGENT_CREW_MODEL is required but not configured.');
    }
    this.model = agentCrewModel;

    const textModel =
      config.get<string>('OPENAI_TEXT_MODEL') ||
      config.get<string>('azure.openaiTextModel');
    if (!textModel) {
      throw new Error('OPENAI_TEXT_MODEL is required but not configured.');
    }
    this.textModel = textModel;

    const imageModel =
      config.get<string>('OPENAI_IMAGE_MODEL') ||
      config.get<string>('azure.openaiImageModel');
    if (!imageModel) {
      throw new Error('OPENAI_IMAGE_MODEL is required but not configured.');
    }
    this.imageModel = imageModel;

    const evaluationModel =
      config.get<string>('OPENAI_EVALUATION_MODEL') ||
      config.get<string>('azure.openaiEvaluationModel');
    if (!evaluationModel) {
      throw new Error('OPENAI_EVALUATION_MODEL is required but not configured.');
    }
    this.evaluationModel = evaluationModel;

    this.logger.log(`[AI MODEL] stage=crew model=${this.model}`);
    this.logger.log(`[AI MODEL] stage=text model=${this.textModel}`);
    this.logger.log(`[AI MODEL] stage=image model=${this.imageModel}`);
    this.logger.log(`[AI MODEL] stage=evaluation model=${this.evaluationModel}`);

    const timeout = config.get<number>('OPENAI_TIMEOUT_MS') ?? 30000;

    this.client = new OpenAI({
      baseURL: config.get<string>('OPENAI_BASE_URL'),
      apiKey: config.get<string>('OPENAI_API_KEY'),
      timeout,
      maxRetries: 2,
    });
  }

  getModelName(): string {
    return this.model;
  }

  getTextModelName(): string {
    return this.textModel;
  }

  getImageModelName(): string {
    return this.imageModel;
  }

  getEvaluationModelName(): string {
    return this.evaluationModel;
  }

  /**
   * Deprecated backward-compatible alias.
   * Prefer getTextModelName() for text moderation.
   */
  getModerationModelName(): string {
    return this.textModel;
  }

  async complete(
    systemPrompt: string,
    userPrompt: string,
    modelOverride?: string,
    options?: TelemetryOptions,
  ): Promise<string> {
    const startTime = Date.now();
    let response: OpenAI.Chat.Completions.ChatCompletion | null = null;
    let errorOccurred: unknown = null;

    try {
      response = await this.client.chat.completions.create({
        model: modelOverride ?? this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
      return response?.choices?.[0]?.message?.content?.trim() ?? '';
    } catch (error) {
      errorOccurred = error;
      throw error;
    } finally {
      const latencyMs = Date.now() - startTime;
      if (options && this.telemetryService) {
        this.telemetryService.recordUsage({
          requestId: options.requestId,
          stage: options.stage,
          process: options.process,
          provider: options.provider || 'azure-openai',
          model: modelOverride ?? this.model,
          modelEnv: options.modelEnv,
          responseUsage: response?.usage || null,
          latencyMs,
          usageAvailable: Boolean(response?.usage),
          success: !errorOccurred && Boolean(response),
          callIndex: options.callIndex,
          error: errorOccurred,
        });
      }
    }
  }

  /** Request a strict JSON object response and parse it. Returns null on failure. */
  async completeJson<T>(
    systemPrompt: string,
    userPrompt: string,
    modelOverride?: string,
    options?: TelemetryOptions,
  ): Promise<T | null> {
    const startTime = Date.now();
    let response: OpenAI.Chat.Completions.ChatCompletion | null = null;
    let errorOccurred: unknown = null;

    try {
      response = await this.client.chat.completions.create({
        model: modelOverride ?? this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      });
      const raw = response?.choices?.[0]?.message?.content;
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as T;
    } catch (error) {
      errorOccurred = error;
      this.logger.warn('JSON completion failed', error);
      return null;
    } finally {
      const latencyMs = Date.now() - startTime;
      if (options && this.telemetryService) {
        this.telemetryService.recordUsage({
          requestId: options.requestId,
          stage: options.stage,
          process: options.process,
          provider: options.provider || 'azure-openai',
          model: modelOverride ?? this.model,
          modelEnv: options.modelEnv,
          responseUsage: response?.usage || null,
          latencyMs,
          usageAvailable: Boolean(response?.usage),
          success: !errorOccurred && Boolean(response),
          callIndex: options.callIndex,
          error: errorOccurred,
        });
      }
    }
  }

  /** GPT-5 vision analysis of a single image URL. */
  async describeImage(
    prompt: string,
    imageUrl: string,
    modelOverride?: string,
    options?: TelemetryOptions,
  ): Promise<string> {
    const startTime = Date.now();
    let response: OpenAI.Chat.Completions.ChatCompletion | null = null;
    let errorOccurred: unknown = null;

    try {
      response = await this.client.chat.completions.create({
        model: modelOverride ?? this.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      });
      return response?.choices?.[0]?.message?.content?.trim() ?? '';
    } catch (error) {
      errorOccurred = error;
      throw error;
    } finally {
      const latencyMs = Date.now() - startTime;
      if (options && this.telemetryService) {
        this.telemetryService.recordUsage({
          requestId: options.requestId,
          stage: options.stage,
          process: options.process,
          provider: options.provider || 'azure-openai',
          model: modelOverride ?? this.model,
          modelEnv: options.modelEnv,
          responseUsage: response?.usage || null,
          latencyMs,
          usageAvailable: Boolean(response?.usage),
          success: !errorOccurred && Boolean(response),
          callIndex: options.callIndex,
          error: errorOccurred,
        });
      }
    }
  }

  /** Request a strict JSON object response using multi-modal inputs (text + multiple images). */
  async completeMultiModalJson<T>(
    systemPrompt: string,
    userPrompt: string,
    imageUrls: string[],
    modelOverride?: string,
    options?: TelemetryOptions,
  ): Promise<T | null> {
    const startTime = Date.now();
    let response: OpenAI.Chat.Completions.ChatCompletion | null = null;
    let errorOccurred: unknown = null;

    try {
      const content: OpenAI.Chat.ChatCompletionContentPart[] = [
        { type: 'text', text: userPrompt },
      ];

      if (Array.isArray(imageUrls)) {
        for (const url of imageUrls) {
          if (url && typeof url === 'string' && url.trim().length > 0) {
            content.push({
              type: 'image_url',
              image_url: { url: url.trim() },
            });
          }
        }
      }

      response = await this.client.chat.completions.create({
        model: modelOverride ?? this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content },
        ],
        response_format: { type: 'json_object' },
      });

      const raw = response?.choices?.[0]?.message?.content;
      if (!raw) {
        return null;
      }

      // Strip markdown code fences if model accidentally wrapped the JSON
      const cleanJson = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      return JSON.parse(cleanJson) as T;
    } catch (error) {
      errorOccurred = error;
      this.logger.warn('Multi-modal JSON completion failed', error);
      return null;
    } finally {
      const latencyMs = Date.now() - startTime;
      if (options && this.telemetryService) {
        this.telemetryService.recordUsage({
          requestId: options.requestId,
          stage: options.stage,
          process: options.process,
          provider: options.provider || 'azure-openai',
          model: modelOverride ?? this.model,
          modelEnv: options.modelEnv,
          responseUsage: response?.usage || null,
          latencyMs,
          usageAvailable: Boolean(response?.usage),
          success: !errorOccurred && Boolean(response),
          callIndex: options.callIndex,
          error: errorOccurred,
        });
      }
    }
  }
}
