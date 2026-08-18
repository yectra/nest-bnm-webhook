import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

/**
 * Azure AI Foundry chat client for the guard's judge node. Points at the same
 * OpenAI v1 endpoint as the rest of the app; the deployment defaults to the
 * crew's GPT-5 deployment when PROMPT_GUARD_MODEL is not set.
 */
@Injectable()
export class GuardLlmProvider {
  private readonly logger = new Logger(GuardLlmProvider.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.model =
      config.get<string>('PROMPT_GUARD_MODEL') ??
      config.get<string>('AGENT_CREW_MODEL') ??
      config.getOrThrow<string>('OPENAI_MODEL');

    this.client = new OpenAI({
      baseURL: config.get<string>('OPENAI_BASE_URL'),
      apiKey: config.get<string>('OPENAI_API_KEY'),
      timeout: config.get<number>('OPENAI_TIMEOUT_MS') ?? 30_000,
      maxRetries: 1,
    });
  }

  getModelName(): string {
    return this.model;
  }

  /** Strict-JSON completion. Returns null on any transport or parse failure. */
  async completeJson<T>(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<T | null> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      });
      const raw = response?.choices?.[0]?.message?.content;
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      this.logger.warn('Guard JSON completion failed', error);
      return null;
    }
  }
}
