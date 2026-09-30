import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * Builds the chat model for the deep agent, pointed at a configured
 * OpenAI-compatible endpoint. Returns undefined when no endpoint is
 * configured — callers degrade gracefully.
 */
@Injectable()
export class AgentModelService {
  private readonly logger = new Logger(AgentModelService.name);

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('whatsappAgent.llm.baseUrl') ||
        this.configService.get<string>('WHATSAPP_AGENT_LLM_BASE_URL'),
    );
  }

  createModel(): BaseChatModel | undefined {
    if (!this.isConfigured()) {
      return undefined;
    }
    const model =
      this.configService.get<string>('whatsappAgent.llm.model') ||
      this.configService.get<string>('WHATSAPP_AGENT_LLM_MODEL');
    if (!model) {
      throw new Error('WHATSAPP_AGENT_LLM_MODEL is required but not configured.');
    }
    this.logger.log(`[AI MODEL] stage=intake model=${model}`);

    const apiKey =
      this.configService.get<string>('whatsappAgent.llm.apiKey') ||
      this.configService.get<string>('WHATSAPP_AGENT_LLM_API_KEY') ||
      'not-required';

    const baseURL =
      this.configService.get<string>('whatsappAgent.llm.baseUrl') ||
      this.configService.get<string>('WHATSAPP_AGENT_LLM_BASE_URL');

    return new ChatOpenAI({
      model,
      apiKey,
      configuration: {
        baseURL,
      },
      maxRetries: 1,
      timeout: 30_000,
    });
  }
}
