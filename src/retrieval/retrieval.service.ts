import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CosmosClient, Database, Container } from '@azure/cosmos';

@Injectable()
export class RetrievalService implements OnModuleInit {
  private readonly logger = new Logger(RetrievalService.name);
  private client: CosmosClient;
  private database: Database;
  private container: Container;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const endpoint = this.configService.get<string>('database.endpoint');
    const key = this.configService.get<string>('database.key');
    const databaseId = this.configService.get<string>('database.database');

    if (!endpoint || !key || !databaseId) {
      this.logger.error('Cosmos DB config missing for RetrievalService.');
      return;
    }

    this.client = new CosmosClient({ endpoint, key });
    this.database = this.client.database(databaseId);
    this.container = this.database.container('KnowledgeBase'); // Assuming a container for knowledge base
  }

  async searchSimilarDocuments(
    embedding: number[],
    topK: number = 3,
  ): Promise<string> {
    try {
      // Execute vector search query against Cosmos DB for MongoDB / NoSQL with Vector Search enabled
      // Since specific vector index syntax can vary, we use a generic VectorDistance approach
      // supported by recent Azure Cosmos NoSQL vector search updates.
      const querySpec = {
        query: `
          SELECT TOP @topK c.content, VectorDistance(c.embedding, @embedding) AS similarityScore
          FROM c
          ORDER BY VectorDistance(c.embedding, @embedding)
        `,
        parameters: [
          { name: '@topK', value: topK },
          { name: '@embedding', value: embedding },
        ],
      };

      const { resources } = await this.container.items
        .query(querySpec)
        .fetchAll();

      if (!resources || resources.length === 0) {
        return '';
      }

      // Combine retrieved contents into a single context string
      return resources.map((r: any) => r.content as string).join('\n\n');
    } catch (error) {
      this.logger.error('Vector search failed', error);
      // Fallback to empty context if vector search isn't properly configured or fails
      return '';
    }
  }
}
