import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CosmosClient, Database, Container } from '@azure/cosmos';

export interface ConversationItem {
  id: string; // conversationId
  question: string;
  aiAnswer: string;
  humanReply?: string;
  status: 'PENDING_HUMAN' | 'RESOLVED';
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class ConversationService implements OnModuleInit {
  private readonly logger = new Logger(ConversationService.name);
  private client: CosmosClient;
  private database: Database;
  private container: Container;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const endpoint = this.configService.get<string>('database.endpoint');
    const key = this.configService.get<string>('database.key');
    const databaseId = this.configService.get<string>('database.database');

    if (!endpoint || !key || !databaseId) {
      throw new Error('Cosmos DB configuration is missing.');
    }

    this.client = new CosmosClient({ endpoint, key });

    const dbResponse = await this.client.databases.createIfNotExists({
      id: databaseId,
    });
    this.database = dbResponse.database;

    const containerResponse = await this.database.containers.createIfNotExists({
      id: 'Conversations',
      partitionKey: { paths: ['/id'] },
    });
    this.container = containerResponse.container;

    this.logger.log('ConversationService initialized and Cosmos DB connected.');
  }

  async createConversation(item: ConversationItem): Promise<void> {
    try {
      await this.container.items.create(item);
    } catch (error) {
      this.logger.error('Failed to create conversation', error);
      throw error;
    }
  }

  async getConversation(id: string): Promise<ConversationItem | null> {
    try {
      const { resource } = await this.container
        .item(id, id)
        .read<ConversationItem>();
      return resource || null;
    } catch (error) {
      this.logger.error(`Failed to read conversation ${id}`, error);
      return null;
    }
  }

  async updateConversationReply(id: string, humanReply: string): Promise<void> {
    const item = await this.getConversation(id);
    if (!item) {
      this.logger.warn(`Conversation ${id} not found for update`);
      return;
    }

    item.humanReply = humanReply;
    item.status = 'RESOLVED';
    item.updatedAt = new Date().toISOString();

    try {
      await this.container.item(id, id).replace(item);
    } catch (error) {
      this.logger.error(`Failed to update conversation ${id}`, error);
      throw error;
    }
  }
}
