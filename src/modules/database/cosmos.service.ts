import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CosmosClient, Database, Container } from '@azure/cosmos';
import {
  buildVectorEmbeddingPolicy,
  buildVectorIndexingPolicy,
  EMBEDDING_DIMENSIONS,
} from './vector-policy';

@Injectable()
export class CosmosService {
  private readonly logger = new Logger(CosmosService.name);
  private readonly client: CosmosClient;
  private readonly database: Database;

  constructor(private readonly configService: ConfigService) {
    this.client = new CosmosClient({
      endpoint: this.configService.get<string>('COSMOS_ENDPOINT')!,
      key: this.configService.get<string>('COSMOS_KEY')!,
    });

    this.database = this.client.database(
      this.configService.get<string>('COSMOS_DATABASE')!,
    );
  }

  getContainer(containerName: string): Container {
    return this.database.container(containerName);
  }

  /**
   * Create a vector-search-enabled container if it does not already exist
   * (Epic A / A1). The container is provisioned with a DiskANN vector index on
   * the `/embedding` path so semantic search runs in the request path.
   *
   * A container's vector embedding policy is fixed at creation time: this helper
   * only configures the policy on a *new* container. Migrating an existing
   * container means recreating it and back-filling — see the A4 runbook.
   *
   * @param containerName container/collection id.
   * @param partitionKeyPath partition key path (e.g. `/userId`, `/id`).
   * @param dimensions vector length (defaults to {@link EMBEDDING_DIMENSIONS}).
   */
  async ensureVectorContainer(
    containerName: string,
    partitionKeyPath: string,
    dimensions: number = this.configService.get<number>(
      'EMBEDDING_DIMENSIONS',
    ) ?? EMBEDDING_DIMENSIONS,
  ): Promise<Container> {
    const { container } = await this.database.containers.createIfNotExists({
      id: containerName,
      partitionKey: { paths: [partitionKeyPath] },
      vectorEmbeddingPolicy: buildVectorEmbeddingPolicy(dimensions),
      indexingPolicy: buildVectorIndexingPolicy(),
    });

    this.logger.log(
      `Vector container ready: "${containerName}" (${dimensions} dims, DiskANN)`,
    );
    return container;
  }
}
