import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';

@Injectable()
export class TwilioService {
  private readonly client: Twilio;

  constructor(private readonly configService: ConfigService) {
    this.client = new Twilio(
      this.configService.get<string>('TWILIO_ACCOUNT_SID'),
      this.configService.get<string>('TWILIO_AUTH_TOKEN'),
    );
  }

  async sendWhatsAppMessage(to: string, body: string) {
    const from = this.configService.get<string>('TWILIO_WHATSAPP_NUMBER');
    const statusCallback = this.configService.get<string>(
      'TWILIO_STATUS_CALLBACK_URL',
    );

    return await this.client.messages.create({
      from,
      to,
      body,
      statusCallback,
    });
  }
}
