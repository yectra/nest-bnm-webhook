import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CosmosService } from '../../database/cosmos.service';

/**
 * Reads customer feedback from Cosmos DB for the deep agent. The container
 * name is configurable (`WHATSAPP_AGENT_FEEDBACK_CONTAINER`, default
 * `CustomerFeedback`) so environments with a different container id keep
 * working without code changes.
 */
@Injectable()
export class CustomerFeedbackService {
  private readonly logger = new Logger(CustomerFeedbackService.name);
  private readonly containerName: string;

  constructor(
    private readonly cosmosService: CosmosService,
    configService: ConfigService,
  ) {
    this.containerName =
      configService.get<string>('whatsappAgent.feedbackContainer') ??
      'CustomerFeedback';
  }

  /**
   * Count the items in the customer feedback container with a cross-partition
   * `COUNT(1)` query. Throws on Cosmos failures — callers decide how to
   * degrade (the hello agent's tool fails open).
   */
  async countFeedbackItems(): Promise<number> {
    const container = this.cosmosService.getContainer(this.containerName);
    const { resources } = await container.items
      .query<number>('SELECT VALUE COUNT(1) FROM c')
      .fetchAll();
    const count = resources[0] ?? 0;
    this.logger.debug(
      `Customer feedback count from "${this.containerName}": ${count}`,
    );
    return count;
  }
}
