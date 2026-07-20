import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import OpenAI from 'openai';

@Injectable()
export class AIService {
  private readonly client: OpenAI;

  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.model = this.config.get<string>('OPENAI_MODEL')!;

    this.client = new OpenAI({
      baseURL: this.config.get<string>('OPENAI_BASE_URL'),

      apiKey: this.config.get<string>('OPENAI_API_KEY'),
    });
  }

  async generate(prompt: string): Promise<string> {
    try {
      // Use the Chat Completion API to generate a response from the LLM.
      // The OpenAI SDK v6 provides `chat.completions.create` which returns
      // a structure containing `choices`. We extract the generated text
      // from the first choice's message content.
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
      });

      // Guard against unexpected shapes – fallback to empty string.
      return response?.choices?.[0]?.message?.content ?? '';
    } catch (e) {
      console.error(e);

      throw new InternalServerErrorException('Azure AI error.');
    }
  }
}
