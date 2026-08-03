import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AzureOpenAI } from 'openai';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private openai: AzureOpenAI;
  private chatModel: string;
  private embeddingModel: string;

  constructor(private configService: ConfigService) {
    const baseURL = this.configService.get<string>('azure.openaiBaseUrl');
    const apiKey = this.configService.get<string>('azure.openaiApiKey');
    this.chatModel = this.configService.get<string>('azure.openaiModel') || '';
    this.embeddingModel =
      this.configService.get<string>('azure.openaiEmbeddingDeployment') || '';

    if (!baseURL || !apiKey || !this.chatModel || !this.embeddingModel) {
      this.logger.error('Azure OpenAI configuration is incomplete.');
    }

    // AzureOpenAI expects an endpoint like https://my-resource.openai.azure.com/
    // If the user's config includes /openai/v1, we need to strip it, otherwise the SDK gets confused.
    const endpoint = (baseURL || '').replace(/\/openai\/v1\/?$/, '');

    // Prevent the OpenAI SDK from automatically picking up the OPENAI_BASE_URL
    // from the environment, which conflicts with our explicit endpoint parameter.
    delete process.env.OPENAI_BASE_URL;

    this.openai = new AzureOpenAI({
      endpoint,
      apiKey,
      apiVersion: '2024-02-01', // Standard default, could be moved to config
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: this.embeddingModel,
        input: text,
      });
      return response.data[0].embedding;
    } catch (error) {
      this.logger.error('Failed to generate embedding', error);
      throw error;
    }
  }

  async generateAnswer(question: string, context: string): Promise<string> {
    try {
      const response = await this.openai.chat.completions.create({
        model: this.chatModel,
        messages: [
          {
            role: 'system',
            content: `You are a helpful AI assistant. Answer the user's question using ONLY the provided context. If the context does not contain the answer, say "I don't know based on the provided context."\n\nContext: ${context}`,
          },
          { role: 'user', content: question },
        ],
        temperature: 0.2,
      });

      return (
        response.choices[0]?.message?.content ||
        'I could not generate an answer.'
      );
    } catch (error) {
      this.logger.error('Failed to generate AI answer', error);
      throw error;
    }
  }
}
