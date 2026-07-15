import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { SendMessageDto } from './dto/send-message.dto';
import { TwilioService } from './twilio.service';

@ApiTags('Twilio')
@Controller('twilio')
export class TwilioController {
    constructor(
        private readonly twilioService: TwilioService,
    ) { }

    @Post('send-message')
    async sendMessage(
        @Body() dto: SendMessageDto,
    ) {
        return this.twilioService.sendWhatsAppMessage(
            dto.to,
            dto.message,
        );
    }
}