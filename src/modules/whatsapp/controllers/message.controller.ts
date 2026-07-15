import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { SendMessageDto } from '../dto/send-message.dto';
import { MessageService } from '../services/message.service';

@ApiTags('Twilio')
@Controller('twilio')
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @Post('send-message')
  async sendMessage(@Body() dto: SendMessageDto) {
    return this.messageService.sendWhatsAppMessage(dto.to, dto.message);
  }
}
