import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ChatbotService } from '../chatbot/chatbot.service';
import { TeamsNotificationService } from './teams-notification.service';

@Injectable()
export class BotService {
  constructor(
    @Inject(forwardRef(() => ChatbotService))
    private readonly chatbotService: ChatbotService,
    private readonly notificationService: TeamsNotificationService,
  ) {}

  async processMessage(message: string) {
    return this.chatbotService.chat(
      null,
      undefined,
      message,
      'teams-session',
      false,
    );
  }
}
