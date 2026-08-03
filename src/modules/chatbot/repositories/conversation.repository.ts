import { Injectable, Logger } from '@nestjs/common';
import { ConversationRecord } from '../interfaces/conversation.interface';
import { CosmosRepository } from './cosmos.repository';

@Injectable()
export class ConversationRepository {
  private readonly logger = new Logger(ConversationRepository.name);
  private readonly containerName = 'Conversations';
  private readonly memoryStore = new Map<string, ConversationRecord[]>();

  constructor(private readonly cosmosRepository: CosmosRepository) {}

  /** Stores a single conversation record permanently */
  async saveConversation(record: ConversationRecord): Promise<ConversationRecord> {
    const conversationId = record.conversationId;
    const history = this.memoryStore.get(conversationId) ?? [];
    
    const recordToSave: ConversationRecord = {
      id: record.id ?? `${conversationId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      ...record,
      timestamp: record.timestamp || new Date().toISOString(),
    };

    history.push(recordToSave);
    if (history.length > 50) {
      history.shift();
    }
    this.memoryStore.set(conversationId, history);

    try {
      await this.cosmosRepository.saveItem(
        this.containerName,
        recordToSave,
        '/conversationId',
      );
      this.logger.log(
        `Saved conversation record for conversationId=${conversationId}, channel=${record.channel}`,
      );
    } catch (error) {
      this.logger.warn(
        `Cosmos DB save skipped or failed for conversationId=${conversationId}, keeping in memory store`,
        error,
      );
    }

    return recordToSave;
  }

  /** Gets conversation history for a given conversationId */
  getHistory(conversationId: string): ConversationRecord[] {
    return this.memoryStore.get(conversationId) ?? [];
  }

  /** Fetch conversation history asynchronously from Cosmos DB if not cached in memory */
  async fetchHistoryFromDb(conversationId: string): Promise<ConversationRecord[]> {
    const cached = this.memoryStore.get(conversationId);
    if (cached && cached.length > 0) {
      return cached;
    }

    try {
      const query = 'SELECT * FROM c WHERE c.conversationId = @conversationId ORDER BY c.timestamp ASC';
      const parameters = [{ name: '@conversationId', value: conversationId }];
      const records = await this.cosmosRepository.queryVector<ConversationRecord>(
        this.containerName,
        query,
        parameters,
      );

      if (records && records.length > 0) {
        this.memoryStore.set(conversationId, records.slice(-50));
        return records;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch conversation history from Cosmos DB for conversationId=${conversationId}`,
        error,
      );
    }

    return [];
  }

  /** Gets formatted chat messages for prompt context */
  getFormattedHistory(conversationId: string) {
    const history = this.getHistory(conversationId);
    const messages: { role: 'user' | 'assistant'; content: string }[] = [];
    
    for (const item of history) {
      if (item.question) {
        messages.push({ role: 'user', content: item.question });
      }
      if (item.answer) {
        messages.push({ role: 'assistant', content: item.answer });
      }
    }
    
    return messages.slice(-10); // Last 10 turns
  }

  clearHistory(conversationId: string): void {
    this.memoryStore.delete(conversationId);
  }
}
