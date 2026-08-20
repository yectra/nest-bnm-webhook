import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostYourRequirementsAgentService } from '../../whatsapp-agent/services/post-your-requirements-agent.service';

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

@Injectable()
export class EventGridService {
  private readonly logger = new Logger(EventGridService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => PostYourRequirementsAgentService))
    private readonly postYourRequirementsAgentService: PostYourRequirementsAgentService,
  ) {}

  async processEvent(payload: EventGridEvent | EventGridEvent[]) {
    const events = Array.isArray(payload) ? payload : [payload];
    const results: any[] = [];

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

      // WhatsApp message received from Java backend
      if (event?.eventType === 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT') {
        this.logCapturedEvent(event);
        results.push({
          status: 'success',
          eventId: event.id,
          eventType: event.eventType,
        });
      }

      // Property requirement submitted — run the dedicated agent and trace to LangSmith
      else if (event?.eventType === 'POST_YOUR_REQUIREMENTS') {
        this.logCapturedEvent(event);

        this.logger.log(
          `[Azure Event Grid] POST_YOUR_REQUIREMENTS event received (id: ${event.id}). Invoking agent...`,
        );

        const agentReply =
          await this.postYourRequirementsAgentService.processEvent(event);

        this.logger.log(
          `[Azure Event Grid] POST_YOUR_REQUIREMENTS agent reply: ${agentReply}`,
        );

        results.push({
          status: 'success',
          eventId: event.id,
          eventType: event.eventType,
          agentReply,
        });
      }

      else {
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
      return validationResult;
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
