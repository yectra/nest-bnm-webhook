import { ChatIntent } from '../enums/chat-intent.enum';

export interface IntentResult {
  intent: ChatIntent;
  confidence: number;
}
