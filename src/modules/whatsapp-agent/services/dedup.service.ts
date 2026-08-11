import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CosmosService } from '../../database/cosmos.service';

/**
 * Event Grid delivery is at-least-once and Twilio retries webhooks, so the
 * same messageSid can arrive more than once. Processed SIDs are persisted in
 * Cosmos; anything already recorded is skipped. Every failure here fails
 * OPEN: a broken dedup store must degrade to "not a duplicate" rather than
 * dropping the message.
 */
@Injectable()
export class DedupService {
  private readonly logger = new Logger(DedupService.name);

  constructor(
    private readonly cosmosService: CosmosService,
    private readonly configService: ConfigService,
  ) {}

  private containerName(): string {
    return (
      this.configService.get<string>('whatsappAgent.containers.processed') ||
      'WhatsAppProcessedMessages'
    );
  }

  /** True when this messageSid was already fully processed. Fails open. */
  async isProcessed(messageSid: string): Promise<boolean> {
    try {
      const container = this.cosmosService.getContainer(this.containerName());
      const { resource } = await container
        .item(messageSid, messageSid)
        .read<{ id: string }>()
        .catch((error: { code?: number }) => {
          if (error?.code === 404) {
            return { resource: undefined };
          }
          throw error;
        });
      return Boolean(resource);
    } catch (error) {
      this.logger.warn(
        `dedup check failed for ${messageSid}, failing open: ${String(error)}`,
      );
      return false;
    }
  }

  /** Record a messageSid as processed. Failures are logged, never thrown. */
  async markProcessed(
    messageSid: string,
    meta: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      const container = this.cosmosService.getContainer(this.containerName());
      await container.items.upsert({
        id: messageSid,
        ...meta,
        processedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn(`dedup mark failed for ${messageSid}: ${String(error)}`);
    }
  }
}
