import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TwilioService } from './twilio.service';

@Injectable()
export class MessageService {
  constructor(
    private readonly twilioService: TwilioService,
    private readonly configService: ConfigService,
  ) {}

  async sendWhatsAppMessage(to: string, body: string) {
    console.log(`=====SEND_WP_MSG_BODY=======`, JSON.stringify(body, null, 2));
    console.log(`=======SEND_WP_MSG_TO======`, to);

    const from =
      this.configService.get<string>('twilio.whatsappNumber') ||
      this.configService.get<string>('TWILIO_WHATSAPP_NUMBER');
    const statusCallback =
      this.configService.get<string>('twilio.statusCallbackUrl') ||
      this.configService.get<string>('TWILIO_STATUS_CALLBACK_URL');

    return await this.twilioService.sendSMSOrWhatsApp({
      from: from || '',
      to,
      body,
      statusCallback,
    });
  }
}
