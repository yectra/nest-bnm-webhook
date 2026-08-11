import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { WhatsappEventHandlerService } from '../services/whatsapp-event-handler.service';
import {
  EventGridEvent,
  SUBSCRIPTION_VALIDATION_EVENT,
  WhatsAppMessage,
} from '../types';

/**
 * Event Grid push-subscription endpoint: POST /api/whatsapp-agent/events.
 * Handles the subscription-validation handshake, then processes
 * BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT events. Accepts both a single event
 * object and an array of events.
 *
 * Responds 200 when every event was handled (including degraded outcomes)
 * and 503 when at least one reply could not be sent because of a transport
 * failure, so Event Grid redelivers; dedup keeps redelivery idempotent for
 * the events that did succeed.
 */
@Controller('whatsapp-agent')
export class WhatsappEventController {
  constructor(
    private readonly handler: WhatsappEventHandlerService,
    private readonly configService: ConfigService,
  ) {}

  @Post('events')
  @HttpCode(200)
  async receive(
    @Body() body: EventGridEvent | EventGridEvent[],
    @Res({ passthrough: true }) response: Response,
  ) {
    const events: EventGridEvent[] = Array.isArray(body) ? body : [body];

    // Subscription validation handshake takes priority over everything else.
    for (const event of events) {
      if (event?.eventType === SUBSCRIPTION_VALIDATION_EVENT) {
        const validationCode = (event.data as { validationCode?: string })
          ?.validationCode;
        return { validationResponse: validationCode };
      }
    }

    const acceptedType =
      this.configService.get<string>('whatsappAgent.eventType') ||
      'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT';

    const results: Array<{ eventId?: string; status: string }> = [];
    let retryNeeded = false;

    for (const event of events) {
      if (event?.eventType !== acceptedType) {
        results.push({ eventId: event?.id, status: 'ignored-event-type' });
        continue;
      }
      try {
        const outcome = await this.handler.handle(
          event.data as WhatsAppMessage,
        );
        if (outcome.status === 'send-failed') {
          retryNeeded = true;
        }
        results.push({ eventId: event?.id, status: outcome.status });
      } catch {
        // Unexpected failure: degrade, ask Event Grid to redeliver the batch.
        retryNeeded = true;
        results.push({ eventId: event?.id, status: 'error' });
      }
    }

    if (retryNeeded) {
      response.status(503);
    }
    return { results };
  }
}
