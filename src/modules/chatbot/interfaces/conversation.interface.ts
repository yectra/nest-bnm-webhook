export type ChatChannel = 'Website' | 'Teams' | 'WhatsApp';

export interface ConversationRecord {
  id?: string;
  conversationId: string;
  userId: string;
  question: string;
  answer: string;
  source: ChatChannel;
  channel: ChatChannel;
  timestamp: string;
  matchedDocuments?: Record<string, unknown>[];
}

export interface ChatMessageItem {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}
