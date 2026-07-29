import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.model = config.get<string>('OPENAI_MODEL') ?? 'gpt-4o';
    const timeout = config.get<number>('OPENAI_TIMEOUT_MS') ?? 20000;

    this.client = new OpenAI({
      baseURL: config.get<string>('OPENAI_BASE_URL'),
      apiKey: config.get<string>('OPENAI_API_KEY'),
      timeout,
      maxRetries: 2,
    });
  }

  async generate(prompt: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
      });

      return response?.choices?.[0]?.message?.content?.trim() ?? 'Hello! How can I assist you today?';
    } catch (error) {
      this.logger.error('Azure AI Foundry / OpenAI generation error', error);
      return 'I am currently unable to reach the AI response service. Please try again shortly or check your OpenAI configuration.';
    }
  }
}
