import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * Builds the chat model for the deep agent, pointed at a low-cost
 * OpenAI-compatible endpoint (default model: gpt-5-mini). Returns
 * undefined when no endpoint is configured — callers must degrade
 * gracefully, never crash.
 */
@Injectable()
export class AgentModelService {
  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.configService.get<string>('whatsappAgent.llm.baseUrl'));
  }

  createModel(): BaseChatModel | undefined {
    if (!this.isConfigured()) {
      return undefined;
    }
    return new ChatOpenAI({
      model:
        this.configService.get<string>('whatsappAgent.llm.model') ||
        'gpt-5-mini',
      apiKey:
        this.configService.get<string>('whatsappAgent.llm.apiKey') ||
        'not-required',
      configuration: {
        baseURL: this.configService.get<string>('whatsappAgent.llm.baseUrl'),
      },
      maxRetries: 1,
      timeout: 30_000,
    });
  }
}
