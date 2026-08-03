import { Injectable, Logger } from '@nestjs/common';
import { CrewLlmProvider } from './crew-llm.provider';
import { VectorSearchResult } from '../../chatbot/interfaces/vector-search.interface';
import { CrewImageInsight } from '../interfaces/crew.interfaces';

const SYNTHESIZER_SYSTEM_PROMPT = `You are the answer-writer for a home-services marketplace assistant.
Compose a helpful, concise answer to the user's question using ONLY the retrieved context below.
If the context does not contain the answer, say so clearly instead of inventing details.
Never include personal contact details (emails, phone numbers, addresses, ID numbers) in your answer,
even if they appear in the context.`;

@Injectable()
export class SynthesizerAgentService {
  private readonly logger = new Logger(SynthesizerAgentService.name);

  constructor(private readonly llm: CrewLlmProvider) {}

  async synthesize(input: {
    question: string;
    history: { role: 'user' | 'assistant'; content: string }[];
    serviceMatches: VectorSearchResult[];
    quoteMatches: VectorSearchResult[];
    imageInsights: CrewImageInsight[];
  }): Promise<string> {
    const { question, history, serviceMatches, quoteMatches, imageInsights } =
      input;

    if (
      serviceMatches.length === 0 &&
      quoteMatches.length === 0 &&
      imageInsights.length === 0
    ) {
      return "Sorry, I couldn't find any matching information.";
    }

    const sections: string[] = [];

    if (serviceMatches.length > 0) {
      sections.push(
        `## Service catalog matches\n${this.formatMatches(serviceMatches)}`,
      );
    }
    if (quoteMatches.length > 0) {
      sections.push(`## User's quotes\n${this.formatMatches(quoteMatches)}`);
    }
    if (imageInsights.length > 0) {
      const imageLines = imageInsights
        .map(
          (insight, index) =>
            `${index + 1}. [${insight.sourceContainer}/${insight.sourceId}] ${insight.summary}`,
        )
        .join('\n');
      sections.push(`## Insights from attached pictures\n${imageLines}`);
    }

    const historyText =
      history.length > 0
        ? `## Recent conversation\n${history
            .map((turn) => `${turn.role}: ${turn.content}`)
            .join('\n')}\n\n`
        : '';

    const userPrompt = `${historyText}${sections.join('\n\n')}\n\n## Question\n${question}`;

    try {
      const answer = await this.llm.complete(
        SYNTHESIZER_SYSTEM_PROMPT,
        userPrompt,
      );
      return answer || "Sorry, I couldn't find any matching information.";
    } catch (error) {
      this.logger.error('Synthesizer GPT-5 generation failed', error);
      return 'I am currently unable to reach the AI response service. Please try again shortly.';
    }
  }

  private formatMatches(matches: VectorSearchResult[]): string {
    return matches
      .map((match, index) => {
        const data = { ...(match.sourceData ?? {}) };
        // Strip bulky/internal fields from the prompt context.
        delete data.embedding;
        delete data._rid;
        delete data._self;
        delete data._etag;
        delete data._attachments;
        return `${index + 1}. [${match.sourceContainer ?? 'unknown'}/${match.id}] similarity=${match.similarity.toFixed(
          2,
        )}\n${JSON.stringify(data)}`;
      })
      .join('\n');
  }
}
