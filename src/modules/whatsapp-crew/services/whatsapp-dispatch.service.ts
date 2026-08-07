import { Injectable, Logger } from '@nestjs/common';
import { MessageService } from '../../whatsapp/services/message.service';
import { WhatsappDispatchResult } from '../interfaces/whatsapp-crew.interfaces';

/**
 * Terminal graph node: sends the PII-filtered reply back to the customer on
 * WhatsApp through the Twilio REST API (asynchronous leg of the webhook —
 * the webhook itself only acked receipt).
 */
@Injectable()
export class WhatsappDispatchService {
  private readonly logger = new Logger(WhatsappDispatchService.name);

  constructor(private readonly messageService: MessageService) {}

  async dispatch(payload: {
    to: string;
    reply: string;
    conversationId: string;
  }): Promise<WhatsappDispatchResult> {
    if (!payload.to) {
      this.logger.warn(
        `No reply target for conversationId=${payload.conversationId}; skipping WhatsApp dispatch`,
      );
      return { whatsappSent: false, error: 'Missing reply target' };
    }

    try {
      const result = await this.messageService.sendWhatsAppMessage(
        payload.to,
        payload.reply,
      );
      this.logger.log(
        `WhatsApp reply sent: sid=${result.sid}, conversationId=${payload.conversationId}`,
      );
      return { whatsappSent: true, messageSid: result.sid };
    } catch (error) {
      this.logger.error(
        `WhatsApp reply failed for conversationId=${payload.conversationId}`,
        error,
      );
      return {
        whatsappSent: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
