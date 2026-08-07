import { Injectable, Logger } from '@nestjs/common';
import { CrewLlmProvider } from '../../agent-crew/services/crew-llm.provider';
import { VectorSearchResult } from '../../chatbot/interfaces/vector-search.interface';
import { WhatsappCrewState } from '../graph/whatsapp-crew-state';
import { WHATSAPP_REPLY_SYSTEM_PROMPT } from '../prompts/whatsapp-crew.prompts';

/**
 * Composes the WhatsApp reply from the retrieved context and the attribution
 * decision. When the LLM is unavailable, falls back to an honest
 * acknowledgement so the customer is never left without a response.
 */
@Injectable()
export class WhatsappReplySynthesizerService {
  private readonly logger = new Logger(WhatsappReplySynthesizerService.name);

  constructor(private readonly llm: CrewLlmProvider) {}

  async synthesize(state: WhatsappCrewState): Promise<string> {
    try {
      const reply = await this.llm.complete(
        WHATSAPP_REPLY_SYSTEM_PROMPT,
        this.buildUserPrompt(state),
      );
      if (reply) {
        return reply;
      }
    } catch (error) {
      this.logger.error('Reply synthesis failed, using fallback reply', error);
    }
    return this.fallbackReply(state);
  }

  private buildUserPrompt(state: WhatsappCrewState): string {
    const sections: string[] = [];

    sections.push(
      `Customer message (type=${state.message?.messageType ?? 'text'}):\n${state.question}`,
    );

    if (state.history.length > 0) {
      const history = state.history
        .slice(-6)
        .map((turn) => `${turn.role}: ${turn.content}`)
        .join('\n');
      sections.push(`Recent conversation:\n${history}`);
    }

    if (state.mediaInsights.length > 0) {
      sections.push(
        `Attachment understanding:\n${state.mediaInsights
          .map((insight) => `- (${insight.kind}) ${insight.summary}`)
          .join('\n')}`,
      );
    }

    if (state.attribution) {
      sections.push(
        `Attribution decision: domain=${state.attribution.domain}, recordId=${state.attribution.recordId ?? 'none'}, confidence=${state.attribution.confidence.toFixed(2)} — ${state.attribution.rationale}`,
      );
    }

    sections.push(this.formatMatches('Project details', state.projectMatches));
    sections.push(this.formatMatches('Quote details', state.quoteMatches));
    sections.push(
      this.formatMatches(
        'Post Your Requirements submissions',
        state.requirementMatches,
      ),
    );
    sections.push(
      this.formatMatches('Feedback form responses', state.feedbackMatches),
    );

    return sections.filter(Boolean).join('\n\n');
  }

  private formatMatches(label: string, matches: VectorSearchResult[]): string {
    if (!matches || matches.length === 0) {
      return '';
    }
    const lines = matches.slice(0, 5).map((match) => {
      const snippet = JSON.stringify(match.sourceData ?? {}).slice(0, 500);
      return `- id=${match.id}: ${snippet}`;
    });
    return `${label}:\n${lines.join('\n')}`;
  }

  private fallbackReply(state: WhatsappCrewState): string {
    const name = state.message?.profileName || 'there';
    return (
      `Hi ${name}, thanks for reaching out. We've logged your message and our team ` +
      `is looking into it. We'll get back to you here on WhatsApp shortly.`
    );
  }
}
