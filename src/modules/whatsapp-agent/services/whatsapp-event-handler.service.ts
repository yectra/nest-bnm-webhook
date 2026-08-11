import { Injectable, Logger } from '@nestjs/common';
import { DedupService } from './dedup.service';
import { ReplyGeneratorService } from './reply-generator.service';
import { SendResult, WhatsappReplyService } from './whatsapp-reply.service';
import { templateReply } from '../reply/templates';
import { GeneratedReply, ProcessOutcome, WhatsAppMessage } from '../types';

/**
 * Process one BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT payload:
 * dedup check (fail open) -> generate reply (fail open to templates) ->
 * send via Twilio -> mark processed.
 *
 * The SID is only marked processed when the message no longer needs an Event
 * Grid retry: after a successful send, or when sending is impossible
 * (Twilio unconfigured). A transport failure leaves the SID unmarked so the
 * next delivery attempt can try again.
 */
@Injectable()
export class WhatsappEventHandlerService {
  private readonly logger = new Logger(WhatsappEventHandlerService.name);

  constructor(
    private readonly dedupService: DedupService,
    private readonly replyGenerator: ReplyGeneratorService,
    private readonly replySender: WhatsappReplyService,
  ) {}

  async handle(message: WhatsAppMessage): Promise<ProcessOutcome> {
    if (!message?.messageSid || !message?.from) {
      return { status: 'ignored', reason: 'missing messageSid or from' };
    }

    if (await this.dedupService.isProcessed(message.messageSid)) {
      this.logger.log(`skipping duplicate message ${message.messageSid}`);
      return { status: 'duplicate' };
    }

    let reply: GeneratedReply;
    try {
      reply = await this.replyGenerator.generate(message);
    } catch (error) {
      this.logger.warn(
        `reply generation failed for ${message.messageSid}, using template: ${String(error)}`,
      );
      reply = { text: templateReply(message), source: 'template' };
    }

    let sendResult: SendResult;
    try {
      sendResult = await this.replySender.send(message.from, reply.text);
    } catch (error) {
      this.logger.warn(
        `Twilio send failed for ${message.messageSid}: ${String(error)}`,
      );
      await this.notifySendOutcome(reply, undefined);
      return { status: 'send-failed', reply: reply.text };
    }

    await this.notifySendOutcome(reply, sendResult.sid);
    await this.dedupService.markProcessed(message.messageSid, {
      from: message.from,
      replySid: sendResult.sid ?? null,
    });

    if (sendResult.skipped) {
      this.logger.log(
        `Twilio not configured; reply for ${message.messageSid} not sent: ${reply.text}`,
      );
      return { status: 'send-skipped', reply: reply.text };
    }
    return {
      status: 'replied',
      replySid: sendResult.sid as string,
      reply: reply.text,
    };
  }

  private async notifySendOutcome(
    reply: GeneratedReply,
    sid: string | undefined,
  ): Promise<void> {
    try {
      await reply.onSent?.(sid);
    } catch (error) {
      this.logger.warn(`onSent callback failed: ${String(error)}`);
    }
  }
}
