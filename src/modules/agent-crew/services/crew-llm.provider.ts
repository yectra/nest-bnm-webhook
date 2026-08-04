import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

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

  constructor(config: ConfigService) {
    this.model =
      config.get<string>('AGENT_CREW_MODEL') ??
      config.get<string>('OPENAI_MODEL') ??
      'gpt-5.1';
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

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    return response?.choices?.[0]?.message?.content?.trim() ?? '';
  }

  /** Request a strict JSON object response and parse it. Returns null on failure. */
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
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as T;
    } catch (error) {
      this.logger.warn('GPT-5 JSON completion failed', error);
      return null;
    }
  }

  /** GPT-5 vision analysis of a single image URL. */
  async describeImage(prompt: string, imageUrl: string, modelOverride?: string): Promise<string> {
    const response = await this.client.chat.completions.create({
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
  }
}
