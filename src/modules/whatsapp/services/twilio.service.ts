import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';

@Injectable()
export class TwilioService {
  private readonly client: Twilio;

  constructor(private readonly configService: ConfigService) {
    const accountSid =
      this.configService.get<string>('twilio.accountSid') ||
      this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken =
      this.configService.get<string>('twilio.authToken') ||
      this.configService.get<string>('TWILIO_AUTH_TOKEN');

    this.client = new Twilio(accountSid || '', authToken || '');
  }

  getClient(): Twilio {
    return this.client;
  }

  async sendSMSOrWhatsApp(options: {
    from: string;
    to: string;
    body: string;
    statusCallback?: string;
  }) {
    return await this.client.messages.create(options);
  }
}
