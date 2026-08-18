import { Injectable, Logger } from '@nestjs/common';

import {
  qualifyWhatsappAgentEvent,
  WhatsappAgentEventKind,
} from '../constants/whatsapp-agent-events';
import { PromptInjectionRagService } from './prompt-injection-rag.service';

/** Minimal Event Grid envelope the agent qualifies. */
export interface QualifiableEvent {
  id?: string;
  eventType?: string;
  subject?: string;
  data?: unknown;
}

/** What the agent did with an event. */
export interface WhatsappAgentEventOutcome {
  kind: WhatsappAgentEventKind;
  /** True when the agent took the branch for this kind. */
  handled: boolean;
  status: 'success' | 'failed' | 'ignored';
  details?: unknown;
}

/**
 * Entry point of the WhatsApp agent for Event Grid traffic.
 *
 * The agent first *qualifies* the event, then branches: an
 * UPDATE_PROMPT_INJECTION_RAG event rebuilds the known-prompt-injection RAG in
 * Cosmos DB, anything else falls through to the existing logging path.
 * Qualification is deliberately separate from handling so the webhook can
 * report what the agent recognised even when the branch itself fails.
 */
@Injectable()
export class WhatsappAgentEventService {
  private readonly logger = new Logger(WhatsappAgentEventService.name);

  constructor(
    private readonly promptInjectionRagService: PromptInjectionRagService,
  ) {}

  /** Classify an event without acting on it. */
  qualify(event: QualifiableEvent): WhatsappAgentEventKind {
    return qualifyWhatsappAgentEvent(event ?? {});
  }

  /** True when the agent has a branch for this event. */
  canHandle(event: QualifiableEvent): boolean {
    return this.qualify(event) !== WhatsappAgentEventKind.Unknown;
  }

  /**
   * Qualify the event and run the matching branch.
   *
   * Never throws: the RAG rebuild reports failures in its result, and an
   * unqualified event is returned as `ignored` so the caller keeps its own
   * handling.
   */
  async handle(event: QualifiableEvent): Promise<WhatsappAgentEventOutcome> {
    const kind = this.qualify(event);

    if (kind === WhatsappAgentEventKind.UpdatePromptInjectionRag) {
      this.logger.log(
        `[WhatsApp agent] Qualified event ${event?.id ?? 'unknown'} as ${kind} — rebuilding the prompt-injection RAG`,
      );
      const details = await this.promptInjectionRagService.rebuild(event?.id);
      return {
        kind,
        handled: true,
        status: details.status === 'success' ? 'success' : 'failed',
        details,
      };
    }

    return { kind, handled: false, status: 'ignored' };
  }
}
