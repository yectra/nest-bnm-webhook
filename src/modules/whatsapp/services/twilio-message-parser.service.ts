import { Injectable, Logger } from '@nestjs/common';
import {
  WHATSAPP_MESSAGE_TYPES,
  WhatsappInboundMessage,
  WhatsappLocation,
  WhatsappMediaItem,
  WhatsappMessageType,
} from '../interfaces/whatsapp-message.interface';

/**
 * Normalizes a raw Twilio WhatsApp webhook form payload into a
 * WhatsappInboundMessage. Twilio's MessageType field is trusted first; when
 * it is absent (older API versions) the type is inferred from the payload
 * shape so every message type is still classified.
 */
@Injectable()
export class TwilioMessageParserService {
  private readonly logger = new Logger(TwilioMessageParserService.name);

  parse(body: Record<string, string>): WhatsappInboundMessage {
    const numMedia = this.toInt(body.NumMedia);
    const media = this.parseMedia(body, numMedia);
    const location = this.parseLocation(body);
    const messageType = this.resolveMessageType(body, media, location);

    const message: WhatsappInboundMessage = {
      messageSid: body.MessageSid || body.SmsSid || body.SmsMessageSid || '',
      accountSid: body.AccountSid,
      from: body.From || '',
      to: body.To || '',
      waId: body.WaId,
      profileName: body.ProfileName,
      body: body.Body ?? '',
      messageType,
      numMedia,
      media,
      location,
      buttonText: body.ButtonText,
      buttonPayload: body.ButtonPayload,
      interactiveReply:
        body.ListId || body.ListTitle
          ? { id: body.ListId, title: body.ListTitle }
          : undefined,
      originalRepliedMessageSid: body.OriginalRepliedMessageSid,
      receivedAt: new Date().toISOString(),
    };

    this.logger.log(
      `Parsed WhatsApp message sid=${message.messageSid}, type=${message.messageType}, media=${message.numMedia}, from=${message.waId ?? message.from}`,
    );
    return message;
  }

  private resolveMessageType(
    body: Record<string, string>,
    media: WhatsappMediaItem[],
    location?: WhatsappLocation,
  ): WhatsappMessageType {
    const declared = (body.MessageType || '').trim().toLowerCase();
    if (
      declared &&
      (WHATSAPP_MESSAGE_TYPES as readonly string[]).includes(declared)
    ) {
      return declared as WhatsappMessageType;
    }

    if (location) {
      return 'location';
    }
    if (body.ListId || body.ListTitle) {
      return 'interactive';
    }
    if (body.ButtonText || body.ButtonPayload) {
      return 'button';
    }
    if (media.length > 0) {
      return this.typeFromContentType(media[0].contentType);
    }
    if ((body.Body ?? '').length > 0) {
      return 'text';
    }
    return 'unknown';
  }

  private typeFromContentType(contentType: string): WhatsappMessageType {
    const normalized = (contentType || '').toLowerCase();
    if (normalized.startsWith('image/webp')) {
      // WhatsApp stickers are delivered as webp images.
      return 'sticker';
    }
    if (normalized.startsWith('image/')) {
      return 'image';
    }
    if (normalized.startsWith('video/')) {
      return 'video';
    }
    if (normalized.startsWith('audio/')) {
      return 'audio';
    }
    if (normalized.includes('vcard') || normalized.includes('contact')) {
      return 'contacts';
    }
    if (normalized.length > 0) {
      return 'document';
    }
    return 'unknown';
  }

  private parseMedia(
    body: Record<string, string>,
    numMedia: number,
  ): WhatsappMediaItem[] {
    const media: WhatsappMediaItem[] = [];
    for (let index = 0; index < numMedia; index += 1) {
      const url = body[`MediaUrl${index}`];
      if (!url) {
        continue;
      }
      media.push({
        index,
        url,
        contentType: body[`MediaContentType${index}`] || '',
      });
    }
    return media;
  }

  private parseLocation(
    body: Record<string, string>,
  ): WhatsappLocation | undefined {
    if (!body.Latitude || !body.Longitude) {
      return undefined;
    }
    const latitude = Number(body.Latitude);
    const longitude = Number(body.Longitude);
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
      return undefined;
    }
    return {
      latitude,
      longitude,
      label: body.Label,
      address: body.Address,
    };
  }

  private toInt(value?: string): number {
    const parsed = parseInt(value ?? '0', 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}
