import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TwilioService } from '../../whatsapp/services/twilio.service';

export interface SendResult {
  /** Twilio message SID when the send succeeded. */
  sid?: string;
  /** True when sending was impossible (unconfigured) rather than failed. */
  skipped: boolean;
}

/**
 * Sends the agent's reply as a Twilio WhatsApp session message via the
 * configured messaging service (falling back to the WhatsApp from-number).
 * Returns { skipped: true } when Twilio is not configured, and throws on a
 * transport error so the caller can let Event Grid retry.
 */
@Injectable()
export class WhatsappReplyService {
  constructor(
    private readonly twilioService: TwilioService,
    private readonly configService: ConfigService,
  ) {}

  private isConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('twilio.accountSid') &&
      this.configService.get<string>('twilio.authToken') &&
      (this.configService.get<string>(
        'whatsappAgent.twilio.messagingServiceSid',
      ) ||
        this.configService.get<string>('twilio.whatsappNumber')),
    );
  }

  async send(to: string, body: string): Promise<SendResult> {
    if (!this.isConfigured()) {
      return { skipped: true };
    }
    const destination = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    const messagingServiceSid = this.configService.get<string>(
      'whatsappAgent.twilio.messagingServiceSid',
    );
    const message = await this.twilioService.getClient().messages.create({
      to: destination,
      body,
      ...(messagingServiceSid
        ? { messagingServiceSid }
        : {
            from: this.configService.get<string>('twilio.whatsappNumber')!,
          }),
    });
    return { sid: message.sid, skipped: false };
  }
}
