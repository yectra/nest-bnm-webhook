import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ChatbotService } from '../chatbot/chatbot.service';

@Injectable()
export class BotService {
  constructor(
    @Inject(forwardRef(() => ChatbotService))
    private readonly chatbotService: ChatbotService,
  ) {}

  async processMessage(
    message: string,
    conversationId = 'teams-session',
    userId = 'teams-user',
  ) {
    return this.chatbotService.processMessage({
      message,
      conversationId,
      sessionId: conversationId,
      userId,
      channel: 'Teams',
    });
  }
}
