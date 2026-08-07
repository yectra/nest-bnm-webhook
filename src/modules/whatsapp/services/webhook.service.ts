import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { twiml, validateRequest } from 'twilio';
import { TwilioMessageParserService } from './twilio-message-parser.service';
import { EventGridPublisherService } from '../../azure-events/event-grid-publisher.service';
import { WHATSAPP_MESSAGE_RECEIVED_EVENT } from '../../azure-events/interfaces/azure-event.interfaces';
import { WhatsappInboundMessage } from '../interfaces/whatsapp-message.interface';

/**
 * Twilio WhatsApp webhook intake. Validates the request signature, normalizes
 * the payload (all WhatsApp message types), publishes an Azure Event Grid
 * event for asynchronous agent-crew processing, and acknowledges Twilio
 * immediately with a short TwiML receipt. The real answer is composed by the
 * WhatsApp crew and sent back over the Twilio REST API once the event is
 * processed.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly messageParser: TwilioMessageParserService,
    private readonly eventPublisher: EventGridPublisherService,
  ) {}

  private getRequestUrl(request: Request) {
    const forwardedProto = request.get('x-forwarded-proto');
    const protocol = forwardedProto ?? request.protocol;
    const host = request.get('host');

    return `${protocol}://${host}${request.originalUrl}`;
  }

  validateTwilioRequest(request: Request, body: Record<string, string>) {
    const authToken =
      this.configService.get<string>('twilio.authToken') ||
      this.configService.get<string>('TWILIO_AUTH_TOKEN');
    const webhookSecret =
      this.configService.get<string>('twilio.webhookSecret') ||
      this.configService.get<string>('TWILIO_WEBHOOK_SECRET');
    const signature = request.get('x-twilio-signature');

    if (!signature) {
      throw new BadRequestException('Missing Twilio signature header.');
    }

    if (webhookSecret && signature !== webhookSecret) {
      throw new BadRequestException('Invalid webhook secret.');
    }

    const isValid = validateRequest(
      authToken ?? '',
      signature,
      this.getRequestUrl(request),
      body,
    );

    if (!isValid) {
      throw new BadRequestException('Invalid Twilio request signature.');
    }
  }

  async receive(request: Request, body?: Record<string, string>) {
    if (!body || Object.keys(body).length === 0) {
      throw new BadRequestException(
        'Webhook payload is missing. Send x-www-form-urlencoded fields like Body, From, and ProfileName.',
      );
    }

    this.validateTwilioRequest(request, body);

    const message = this.messageParser.parse(body);

    const publishResult = await this.eventPublisher.publish(
      WHATSAPP_MESSAGE_RECEIVED_EVENT,
      `whatsapp/messages/${message.messageSid || 'unknown'}`,
      { message },
    );

    this.logger.log(
      `WhatsApp message queued for async processing: sid=${message.messageSid}, type=${message.messageType}, transport=${publishResult.transport}, eventId=${publishResult.eventId}`,
    );

    const response = new twiml.MessagingResponse();
    response.message(this.buildAcknowledgement(message));

    return {
      xml: response.toString(),
      message,
      publishResult,
    };
  }

  /** Short synchronous receipt; the crew's real answer follows asynchronously. */
  private buildAcknowledgement(message: WhatsappInboundMessage): string {
    const name = message.profileName || 'there';

    switch (message.messageType) {
      case 'audio':
      case 'voice':
        return `Hi ${name}, we received your voice note and are reviewing it. We'll reply shortly.`;
      case 'image':
      case 'video':
      case 'sticker':
      case 'document':
        return `Hi ${name}, we received your attachment and are reviewing it. We'll reply shortly.`;
      case 'location':
        return `Hi ${name}, thanks for sharing your location. We're on it and will reply shortly.`;
      case 'contacts':
        return `Hi ${name}, we received the contact details you shared. We'll reply shortly.`;
      default:
        return `Hi ${name}, thanks for your message. We're looking into it and will reply shortly.`;
    }
  }
}
