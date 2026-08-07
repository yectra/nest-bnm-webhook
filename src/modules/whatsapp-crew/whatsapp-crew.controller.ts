import {
  Body,
  Controller,
  ForbiddenException,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { WhatsappCrewService } from './whatsapp-crew.service';
import {
  AzureEventGridEvent,
  WHATSAPP_MESSAGE_RECEIVED_EVENT,
  WhatsappMessageReceivedEventData,
} from '../azure-events/interfaces/azure-event.interfaces';

interface SubscriptionValidationData {
  validationCode?: string;
}

const SUBSCRIPTION_VALIDATION_EVENT =
  'Microsoft.EventGrid.SubscriptionValidationEvent';

/**
 * Azure Event Grid push-subscription endpoint. Event Grid delivers the
 * WhatsApp-message events published by the Twilio webhook here; processing is
 * kicked off in the background and the delivery is acked immediately so
 * Event Grid never times out and retries a slow crew run.
 */
@ApiTags('WhatsApp Crew')
@Controller('webhook/whatsapp')
export class WhatsappCrewController {
  private readonly logger = new Logger(WhatsappCrewController.name);
  private readonly webhookSecret?: string;

  constructor(
    private readonly crewService: WhatsappCrewService,
    config: ConfigService,
  ) {
    this.webhookSecret = config.get<string>('AZURE_EVENT_GRID_WEBHOOK_SECRET');
  }

  @Post('events')
  @ApiExcludeEndpoint()
  receiveEvents(
    @Body() body: AzureEventGridEvent[] | AzureEventGridEvent,
    @Query('code') code?: string,
  ) {
    if (this.webhookSecret && code !== this.webhookSecret) {
      throw new ForbiddenException('Invalid event webhook secret.');
    }

    const events = Array.isArray(body) ? body : [body];

    for (const event of events) {
      if (!event || typeof event !== 'object') {
        continue;
      }

      if (event.eventType === SUBSCRIPTION_VALIDATION_EVENT) {
        const data = event.data as SubscriptionValidationData;
        this.logger.log(
          `Event Grid subscription validation handshake (eventId=${event.id})`,
        );
        return { validationResponse: data?.validationCode };
      }

      if (event.eventType === WHATSAPP_MESSAGE_RECEIVED_EVENT) {
        // Fire-and-forget: ack the delivery now, run the crew in background.
        void this.crewService.handleEvent(
          event.data as WhatsappMessageReceivedEventData,
          event.id,
        );
      } else {
        this.logger.warn(
          `Ignoring unexpected event type "${event.eventType}" (eventId=${event.id})`,
        );
      }
    }

    return { accepted: events.length };
  }
}
