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
      const response = await this.client.responses.create({
        model: this.model,

        input: prompt,
      });

      return response.output_text;
    } catch (e) {
      console.error(e);

      throw new InternalServerErrorException('Azure AI error.');
    }
  }
}
