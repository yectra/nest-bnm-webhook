import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CompiledWhatsappCrewGraph,
  WhatsappCrewGraphFactory,
} from './graph/whatsapp-crew-graph.factory';
import { WhatsappInboundMessage } from '../whatsapp/interfaces/whatsapp-message.interface';
import { ConversationRepository } from '../chatbot/repositories/conversation.repository';
import { LocalEventBus } from '../azure-events/local-event-bus';
import {
  WHATSAPP_MESSAGE_RECEIVED_EVENT,
  WhatsappMessageReceivedEventData,
} from '../azure-events/interfaces/azure-event.interfaces';
import { WhatsappCrewState } from './graph/whatsapp-crew-state';

/**
 * Entry point for the WhatsApp LangGraph agent crew. Compiles the graph once,
 * then processes every WhatsApp-message event (delivered either by the Azure
 * Event Grid push subscription or by the local event-bus fallback):
 *
 * intake (all message types) -> supervisor -> parallel retrieval over the
 * customer's project details, quote details, Post Your Requirements
 * submissions, and feedback form responses -> response attribution ->
 * reply synthesis -> PII filter -> WhatsApp reply via Twilio.
 */
@Injectable()
export class WhatsappCrewService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappCrewService.name);
  private graph!: CompiledWhatsappCrewGraph;
  private readonly crewEnabled: boolean;

  constructor(
    private readonly graphFactory: WhatsappCrewGraphFactory,
    private readonly conversationRepository: ConversationRepository,
    private readonly localEventBus: LocalEventBus,
    config: ConfigService,
  ) {
    const flag = config.get<string | boolean>('WHATSAPP_CREW_ENABLED');
    this.crewEnabled = flag !== 'false' && flag !== false;
  }

  onModuleInit() {
    this.graph = this.graphFactory.build();
    this.localEventBus.subscribe<WhatsappMessageReceivedEventData>(
      WHATSAPP_MESSAGE_RECEIVED_EVENT,
      (event) => this.handleEvent(event.data, event.id),
    );
    this.logger.log(
      'WhatsApp crew graph compiled and subscribed to local event bus',
    );
  }

  /** Shared entry for Event Grid deliveries and local-bus fallbacks. */
  async handleEvent(
    data: WhatsappMessageReceivedEventData | undefined,
    eventId: string,
  ): Promise<void> {
    const message = data?.message;
    if (!message || !message.from) {
      this.logger.warn(
        `Discarding malformed WhatsApp message event (eventId=${eventId})`,
      );
      return;
    }
    try {
      await this.process(message);
    } catch (error) {
      this.logger.error(
        `WhatsApp crew processing failed (eventId=${eventId}, sid=${message.messageSid})`,
        error,
      );
    }
  }

  async process(message: WhatsappInboundMessage): Promise<WhatsappCrewState> {
    const conversationId = `whatsapp:${message.waId || message.from}`;
    const userId = message.waId || message.from || 'anonymous';
    const timestamp = new Date().toISOString();

    if (!this.crewEnabled) {
      this.logger.warn(
        'WhatsApp crew disabled by WHATSAPP_CREW_ENABLED flag; skipping processing',
      );
      return Promise.reject(new Error('WhatsApp crew disabled'));
    }

    this.logger.log(
      `[WhatsappCrew] Run started. conversationId=${conversationId}, sid=${message.messageSid}, type=${message.messageType}`,
    );

    const finalState = await this.graph.invoke({
      message,
      conversationId,
      userId,
      question: message.body,
      history: this.conversationRepository.getFormattedHistory(conversationId),
    });

    this.logger.log(
      `[WhatsappCrew] Run finished. conversationId=${conversationId}, attribution=${finalState.attribution?.domain ?? 'none'}, whatsappSent=${finalState.dispatch.whatsappSent}`,
    );

    void this.conversationRepository.saveConversation({
      conversationId,
      userId,
      question: finalState.question,
      answer: finalState.finalReply,
      source: 'WhatsApp',
      channel: 'WhatsApp',
      timestamp,
      matchedDocuments: [
        ...(finalState.projectMatches || []),
        ...(finalState.quoteMatches || []),
        ...(finalState.requirementMatches || []),
        ...(finalState.feedbackMatches || []),
      ].map((match) => ({
        id: match.id,
        sourceContainer: match.sourceContainer,
        similarity: match.similarity,
      })),
    });

    return finalState;
  }
}
