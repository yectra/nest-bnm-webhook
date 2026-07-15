import { Injectable, Logger } from '@nestjs/common';
import { TwilioService } from '../twilio/twilio.service';

@Injectable()
export class WebhookService {
    private readonly logger = new Logger(WebhookService.name);

    constructor(
        private readonly twilioService: TwilioService,
    ) { }

    async receive(body: any) {
        const {
            Body,
            From,
            ProfileName,
        } = body;

        this.logger.log(`User : ${ProfileName}`);
        this.logger.log(`Message : ${Body}`);

        await this.twilioService.sendWhatsAppMessage(
            From,
            `Hello ${ProfileName} 👋

You said:

"${Body}"

This reply is coming from NestJS 🚀`,
        );

        return {
            success: true,
        };
    }
}