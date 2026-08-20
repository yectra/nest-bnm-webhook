import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostYourRequirementsAgentService } from '../../whatsapp-agent/services/post-your-requirements-agent.service';

export interface EventGridEvent<T = any> {
  id?: string;
  eventId?: string;
  eventType?: string;
  eventName?: string;
  subject?: string;
  eventTime?: string;
  eventTimestamp?: string;
  data?: T;
  payload?: T;
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
    @Optional()
    private readonly postYourRequirementsAgentService?: any,
  ) {}

  async processEvent(payload: EventGridEvent | EventGridEvent[]) {
    const events = Array.isArray(payload) ? payload : [payload];
    const results: any[] = [];

    for (const event of events) {
      // Handle Azure Event Grid Subscription Validation Handshake
      if (
        event?.eventType === 'Microsoft.EventGrid.SubscriptionValidationEvent'
      ) {
        const validationData = (event.data || event.payload) as SubscriptionValidationData;
        const validationCode = validationData?.validationCode;

        this.logger.log(
          `[Azure Event Grid] Subscription validation handshake received. Code: ${validationCode}`,
        );

        results.push({ validationResponse: validationCode });
        continue;
      }

      const typeName = event?.eventType || event?.eventName || 'UNKNOWN_EVENT';

      // Log captured event details for EVERY incoming event
      this.logCapturedEvent(event);

      // Handle Post Your Requirements Agent service integration if present
      if (
        typeName === 'POST_YOUR_REQUIREMENTS' &&
        this.postYourRequirementsAgentService?.processEvent
      ) {
        const agentReply = await this.postYourRequirementsAgentService.processEvent(event);
        results.push({
          status: 'success',
          eventId: event?.id || event?.eventId || 'N/A',
          eventType: typeName,
          agentReply,
        });
        continue;
      }

      results.push({
        status: 'success',
        eventId: event?.id || event?.eventId || 'N/A',
        eventType: typeName,
      });
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
      eventName: event.eventType || event.eventName || 'N/A',
      eventId: event.id || event.eventId || 'N/A',
      eventTimestamp: event.eventTime || event.eventTimestamp || 'N/A',
      subject: event.subject || event.topic || 'N/A',
      payload: event.payload ?? event.data ?? {},
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
