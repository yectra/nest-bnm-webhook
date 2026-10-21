import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { TokenBudgetService } from '../../token-budget/token-budget.service';

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(
    config: ConfigService,
    @Optional() private readonly tokenBudgetService?: TokenBudgetService,
  ) {
    const model =
      config.get<string>('OPENAI_MODEL') ||
      config.get<string>('azure.openaiModel');
    if (!model) {
      throw new Error('OPENAI_MODEL is required but not configured.');
    }
    this.model = model;
    this.logger.log(`[AI MODEL] stage=chat model=${this.model}`);
    const timeout = config.get<number>('OPENAI_TIMEOUT_MS') ?? 20000;

    this.client = new OpenAI({
      baseURL: config.get<string>('OPENAI_BASE_URL'),
      apiKey: config.get<string>('OPENAI_API_KEY'),
      timeout,
      maxRetries: 2,
    });
  }

  async generate(prompt: string): Promise<string> {
    const estimatedTokens = Math.max(200, Math.ceil(prompt.length / 3) + 400);
    let reservationId: string | undefined;

    if (this.tokenBudgetService) {
      const reservation = await this.tokenBudgetService.reserveTokens({
        stage: 'chatbot_generate',
        process: 'chatbot',
        model: this.model,
        modelEnv: 'OPENAI_MODEL',
        estimatedTokens,
      });

      if (!reservation.allowed) {
        this.logger.warn(
          `AI_TOKEN_BUDGET_EXHAUSTED: rolling 24-hour token limit reached; chatbot request skipped.`,
        );
        return 'The AI assistant is temporarily unavailable due to token limit constraints. Please try again later.';
      }
      reservationId = reservation.reservationId;
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
      });

      if (this.tokenBudgetService && reservationId) {
        const usage = response?.usage;
        const inputTokens = usage?.prompt_tokens ?? 0;
        const outputTokens = usage?.completion_tokens ?? 0;
        const totalTokens = usage?.total_tokens ?? (inputTokens + outputTokens);

        await this.tokenBudgetService.reconcileUsage({
          reservationId,
          actualUsage: {
            inputTokens,
            outputTokens,
            totalTokens: totalTokens > 0 ? totalTokens : estimatedTokens,
          },
          success: true,
        });
      }

      return (
        response?.choices?.[0]?.message?.content?.trim() ??
        'Hello! How can I assist you today?'
      );
    } catch (error) {
      if (this.tokenBudgetService && reservationId) {
        await this.tokenBudgetService.reconcileUsage({
          reservationId,
          actualUsage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: estimatedTokens,
          },
          success: false,
          error,
        });
      }
      this.logger.error('Azure AI Foundry / OpenAI generation error', error);
      return 'I am currently unable to reach the AI response service. Please try again shortly or check your OpenAI configuration.';
    }
  }
}
