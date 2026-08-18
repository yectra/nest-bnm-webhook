import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { WhatsappAgentEventService } from '../../whatsapp-agent/services/whatsapp-agent-event.service';
import { WhatsappAgentEventKind } from '../../whatsapp-agent/constants/whatsapp-agent-events';

export interface EventGridEvent<T = any> {
  id?: string;
  eventType?: string;
  subject?: string;
  eventTime?: string;
  data?: T;
  topic?: string;
  dataVersion?: string;
  metadataVersion?: string;
}

export interface SubscriptionValidationData {
  validationCode: string;
  validationUrl?: string;
}

/** Per-event outcome reported back to Event Grid. */
export interface ProcessedEventResult {
  status?: 'success' | 'failed' | 'ignored';
  eventId?: string;
  eventType?: string;
  /** Present only for the subscription validation handshake. */
  validationResponse?: string;
  /** How the WhatsApp agent qualified the event, when it did. */
  agentEventKind?: WhatsappAgentEventKind;
  /** Summary of the RAG rebuild, for UPDATE_PROMPT_INJECTION_RAG events. */
  promptInjectionRag?: unknown;
}

/** Response body of the Event Grid webhook. */
export interface EventGridProcessingResponse {
  message: string;
  processedCount: number;
  results: ProcessedEventResult[];
}

@Injectable()
export class EventGridService {
  private readonly logger = new Logger(EventGridService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly whatsappAgentEventService: WhatsappAgentEventService,
  ) {}

  async processEvent(
    payload: EventGridEvent | EventGridEvent[],
  ): Promise<
    | EventGridProcessingResponse
    | Pick<ProcessedEventResult, 'validationResponse'>
  > {
    const events = Array.isArray(payload) ? payload : [payload];
    const results: ProcessedEventResult[] = [];

    for (const event of events) {
      // Handle Azure Event Grid Subscription Validation Handshake
      if (
        event?.eventType === 'Microsoft.EventGrid.SubscriptionValidationEvent'
      ) {
        const validationData = event.data as SubscriptionValidationData;
        const validationCode = validationData?.validationCode;

        this.logger.log(
          `[Azure Event Grid] Subscription validation handshake received. Code: ${validationCode}`,
        );

        results.push({ validationResponse: validationCode });
        continue;
      }

      // The WhatsApp agent qualifies the event first: an
      // UPDATE_PROMPT_INJECTION_RAG event branches into the RAG rebuild
      // instead of the plain logging path below.
      const kind = this.whatsappAgentEventService.qualify(event ?? {});
      if (kind === WhatsappAgentEventKind.UpdatePromptInjectionRag) {
        this.logCapturedEvent(event);
        const outcome = await this.whatsappAgentEventService.handle(event);
        results.push({
          status: outcome.status,
          eventId: event?.id,
          eventType: event?.eventType,
          agentEventKind: outcome.kind,
          promptInjectionRag: outcome.details,
        });
        continue;
      }

      // Log event details if matching target event or standard Event Grid event
      if (kind === WhatsappAgentEventKind.MessageReceived) {
        this.logCapturedEvent(event);
        results.push({
          status: 'success',
          eventId: event.id,
          eventType: event.eventType,
        });
      } else {
        this.logger.warn(
          `[Azure Event Grid] Received unknown or unhandled event type: ${event?.eventType}`,
        );
        this.logCapturedEvent(event);
        results.push({
          status: 'ignored',
          eventId: event?.id,
          eventType: event?.eventType,
        });
      }
    }

    // Return validation response for subscription handshake if present
    const validationResult = results.find((r) => r.validationResponse);
    if (validationResult) {
      return { validationResponse: validationResult.validationResponse };
    }

    return {
      message: 'Event Grid payload processed successfully',
      processedCount: events.length,
      results,
    };
  }

  private logCapturedEvent(event: EventGridEvent) {
    const appEnv =
      this.configService.get<string>('app.appEnv') ||
      process.env.APP_ENV ||
      'main';
    const nodeEnv =
      this.configService.get<string>('NODE_ENV') ||
      process.env.NODE_ENV ||
      'development';

    const nestAppDetails = {
      appName: 'BNM Webhook Backend (NestJS)',
      environment: {
        appEnv,
        nodeEnv,
      },
      processId: process.pid,
      serverTimestamp: new Date().toISOString(),
      handler: 'EventGridService.processEvent',
    };

    const eventDetails = {
      eventName: event.eventType || 'N/A',
      eventId: event.id || 'N/A',
      eventTimestamp: event.eventTime || 'N/A',
      subject: event.subject || event.topic || 'N/A',
      payload: event.data ?? {},
    };

    this.logger.log(
      `==================== AZURE EVENT GRID EVENT CAPTURED ====================\n` +
        `--- NestJS Application Details ---\n` +
        JSON.stringify(nestAppDetails, null, 2) +
        `\n--- Captured Event Details ---\n` +
        JSON.stringify(eventDetails, null, 2) +
        `\n========================================================================`,
    );
  }
}
