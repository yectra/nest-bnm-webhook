import { Injectable } from '@nestjs/common';
import { ChatbotService } from '../chatbot/chatbot.service';

@Injectable()
export class BotService {
  constructor(private readonly chatbotService: ChatbotService) {}

  async processMessage(message: string) {
    return this.chatbotService.chat(null, undefined, message, 'teams-session');
  }
}
