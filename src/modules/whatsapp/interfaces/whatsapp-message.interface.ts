/**
 * Normalized model of an inbound Twilio WhatsApp webhook payload.
 * Every message type Twilio can deliver for WhatsApp maps onto this shape.
 */

export const WHATSAPP_MESSAGE_TYPES = [
  'text',
  'image',
  'video',
  'audio',
  'voice',
  'document',
  'sticker',
  'location',
  'contacts',
  'button',
  'interactive',
  'reaction',
  'unknown',
] as const;

export type WhatsappMessageType = (typeof WHATSAPP_MESSAGE_TYPES)[number];

export interface WhatsappMediaItem {
  index: number;
  url: string;
  contentType: string;
}

export interface WhatsappLocation {
  latitude: number;
  longitude: number;
  label?: string;
  address?: string;
}

export interface WhatsappInteractiveReply {
  id?: string;
  title?: string;
}

export interface WhatsappInboundMessage {
  messageSid: string;
  accountSid?: string;
  /** Twilio address, e.g. "whatsapp:+15551234567". Reply target. */
  from: string;
  to: string;
  /** Customer phone in E.164 without the whatsapp: prefix. */
  waId?: string;
  profileName?: string;
  body: string;
  messageType: WhatsappMessageType;
  numMedia: number;
  media: WhatsappMediaItem[];
  location?: WhatsappLocation;
  buttonText?: string;
  buttonPayload?: string;
  interactiveReply?: WhatsappInteractiveReply;
  /** Sid of the message the customer replied/reacted to, when present. */
  originalRepliedMessageSid?: string;
  receivedAt: string;
}
