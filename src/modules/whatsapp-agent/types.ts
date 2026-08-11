/** Payload published by the upstream Java webhook app for each inbound message. */
export type WhatsAppMessageType =
  | 'TEXT'
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO'
  | 'DOCUMENT'
  | 'STICKER'
  | 'LOCATION'
  | 'CONTACTS'
  | 'BUTTON'
  | 'INTERACTIVE'
  | 'UNKNOWN';

export interface WhatsAppMediaItem {
  blobUrl?: string;
  contentType?: string;
  fileName?: string;
}

export interface WhatsAppMessage {
  messageSid: string;
  from: string; // "whatsapp:+91..."
  to?: string;
  body?: string;
  profileName?: string;
  numMedia?: number;
  media?: WhatsAppMediaItem[];
  messageType?: WhatsAppMessageType;
  latitude?: number | string;
  longitude?: number | string;
  address?: string;
  label?: string;
  buttonText?: string;
  buttonPayload?: string;
  originalRepliedMessageSid?: string;
  direction?: string;
  receivedAt?: string;
}

/** Event Grid event envelope (push delivery). */
export interface EventGridEvent {
  id?: string;
  eventType?: string;
  subject?: string;
  eventTime?: string;
  data?: unknown;
  dataVersion?: string;
  topic?: string;
}

export const SUBSCRIPTION_VALIDATION_EVENT =
  'Microsoft.EventGrid.SubscriptionValidationEvent';

/** "whatsapp:+919876543210" -> "+919876543210" */
export function normalizePhone(raw: string | undefined): string {
  return (raw ?? '').replace(/^whatsapp:/i, '').trim();
}

export type ReplySource = 'agent' | 'template' | 'refusal';

export interface GeneratedReply {
  text: string;
  /** Where the reply came from. */
  source?: ReplySource;
  /**
   * Called once the send outcome is known, with the Twilio SID on success
   * and undefined on failure/skip. The agent uses this to keep the assistant
   * turn out of checkpointed history when the reply was never delivered.
   */
  onSent?: (sid: string | undefined) => Promise<void>;
}

export type ProcessOutcome =
  | { status: 'replied'; replySid: string; reply: string }
  | { status: 'send-disabled'; reply: string }
  | { status: 'send-skipped'; reply: string }
  | { status: 'send-failed'; reply: string }
  | { status: 'duplicate' }
  | { status: 'ignored'; reason: string };
