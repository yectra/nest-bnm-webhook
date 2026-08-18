import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * Builds the Azure AI Foundry chat model (gpt-5-mini deployment) that backs
 * the "Post Your Requirements" deep agent.
 *
 * gpt-5-mini is a reasoning model, so no temperature override is sent. Returns
 * undefined when the Foundry endpoint is not configured — callers must degrade
 * gracefully, never crash.
 */
@Injectable()
export class FoundryModelService {
  private readonly logger = new Logger(FoundryModelService.name);

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('whatsappAgent.foundry.baseUrl') &&
      this.configService.get<string>('whatsappAgent.foundry.apiKey'),
    );
  }

  getModelName(): string {
    return (
      this.configService.get<string>('whatsappAgent.foundry.model') ||
      'gpt-5-mini'
    );
  }

  createModel(): BaseChatModel | undefined {
    if (!this.isConfigured()) {
      this.logger.warn(
        'Azure AI Foundry endpoint is not configured; the requirements agent will answer without an LLM',
      );
      return undefined;
    }

    return new ChatOpenAI({
      model: this.getModelName(),
      apiKey: this.configService.get<string>('whatsappAgent.foundry.apiKey'),
      configuration: {
        baseURL: this.configService.get<string>(
          'whatsappAgent.foundry.baseUrl',
        ),
      },
      maxRetries: 1,
      timeout:
        this.configService.get<number>('whatsappAgent.foundry.timeoutMs') ??
        30_000,
    });
  }
}
