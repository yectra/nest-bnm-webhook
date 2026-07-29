import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CosmosClient, Database, Container, SqlParameter } from '@azure/cosmos';
import {
  buildVectorEmbeddingPolicy,
  buildVectorIndexingPolicy,
  EMBEDDING_DIMENSIONS,
} from '../../database/vector-policy';

@Injectable()
export class CosmosRepository {
  private readonly logger = new Logger(CosmosRepository.name);
  private readonly client: CosmosClient;
  private readonly database: Database;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('COSMOS_ENDPOINT')!;
    const key = this.configService.get<string>('COSMOS_KEY')!;
    const databaseName = this.configService.get<string>('COSMOS_DATABASE')!;

    this.client = new CosmosClient({ endpoint, key });
    this.database = this.client.database(databaseName);
  }

  getContainer(containerName: string): Container {
    return this.database.container(containerName);
  }

  async ensureVectorContainer(
    containerName: string,
    partitionKeyPath: string = '/id',
    dimensions: number = this.configService.get<number>('EMBEDDING_DIMENSIONS') ??
      EMBEDDING_DIMENSIONS,
  ): Promise<Container> {
    try {
      const { container } = await this.database.containers.createIfNotExists({
        id: containerName,
        partitionKey: { paths: [partitionKeyPath] },
        vectorEmbeddingPolicy: buildVectorEmbeddingPolicy(dimensions),
        indexingPolicy: buildVectorIndexingPolicy(),
      });
      return container;
    } catch (error) {
      this.logger.error(
        `Failed to ensure container "${containerName}" with vector policy`,
        error,
      );
      return this.database.container(containerName);
    }
  }

  /**
   * Directly queries a container in Cosmos DB without blocking administrative calls.
   */
  async queryVector<T>(
    containerName: string,
    query: string,
    parameters: SqlParameter[],
    abortSignal?: AbortSignal,
  ): Promise<T[]> {
    try {
      const container = this.database.container(containerName);
      const { resources } = await container.items
        .query<T>({ query, parameters }, { abortSignal })
        .fetchAll();
      return resources;
    } catch (error) {
      this.logger.warn(`Cosmos DB vector query error on "${containerName}"`, error);
      return [];
    }
  }

  async saveItem<T extends { id?: string }>(
    containerName: string,
    item: T,
    partitionKeyPath: string = '/id',
  ): Promise<T> {
    try {
      const container = await this.ensureVectorContainer(
        containerName,
        partitionKeyPath,
      );
      const { resource } = await container.items.upsert(item);
      return (resource as unknown as T) ?? item;
    } catch (error) {
      this.logger.warn(`Cosmos DB saveItem skipped or failed on "${containerName}"`, error);
      return item;
    }
  }
}
