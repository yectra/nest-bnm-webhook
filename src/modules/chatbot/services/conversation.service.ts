import { Injectable } from '@nestjs/common';
import { ChatMessage } from 'src/common/interfaces/chat-message.interface';

@Injectable()
export class ConversationService {
  private readonly conversations = new Map<string, ChatMessage[]>();

  getMessages(sessionId: string): ChatMessage[] {
    return this.conversations.get(sessionId) ?? [];
  }

  addMessage(sessionId: string, message: ChatMessage) {
    const history = this.getMessages(sessionId);

    history.push(message);

    // Keep only the last 20 messages
    if (history.length > 20) {
      history.shift();
    }

    this.conversations.set(sessionId, history);
  }

  clear(sessionId: string) {
    this.conversations.delete(sessionId);
  }
}
