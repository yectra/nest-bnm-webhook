import { WhatsappInboundMessage } from '../../whatsapp/interfaces/whatsapp-message.interface';

/** Event type published when a WhatsApp message arrives on the Twilio webhook. */
export const WHATSAPP_MESSAGE_RECEIVED_EVENT = 'Bnm.Whatsapp.MessageReceived';

/** Azure Event Grid custom-topic event envelope (EventGridEvent schema). */
export interface AzureEventGridEvent<T = unknown> {
  id: string;
  eventType: string;
  subject: string;
  eventTime: string;
  data: T;
  dataVersion: string;
}

/** Data payload carried by a WHATSAPP_MESSAGE_RECEIVED_EVENT. */
export interface WhatsappMessageReceivedEventData {
  message: WhatsappInboundMessage;
}

/** Transport actually used for a publish. */
export type EventTransport = 'eventgrid' | 'local';

export interface EventPublishResult {
  published: boolean;
  transport: EventTransport;
  eventId: string;
  error?: string;
}
