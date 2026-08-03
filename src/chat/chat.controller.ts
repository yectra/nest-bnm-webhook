import { Controller, Post, Body } from '@nestjs/common';
import { ChatService } from './chat.service';

import { IsString, IsNotEmpty } from 'class-validator';

export class ChatDto {
  @IsString()
  @IsNotEmpty()
  question: string;
}

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  async chat(@Body() body: ChatDto) {
    if (!body.question) {
      throw new Error('Question is required');
    }
    return this.chatService.handleChat(body.question);
  }
}
