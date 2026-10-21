import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Container } from '@azure/cosmos';
import { CosmosService } from '../database/cosmos.service';
import {
  ActiveBudgetDocument,
  LedgerEntry,
  ResetAuditEntry,
} from './token-budget.types';

export const GLOBAL_PK = 'global';
export const ACTIVE_BUDGET_DOC_ID = 'active_budget';

@Injectable()
export class TokenBudgetRepository implements OnModuleInit {
  private readonly logger = new Logger(TokenBudgetRepository.name);
  private container: Container | null = null;
  private containerName: string;
  private isInitialized = false;

  constructor(
    private readonly cosmosService: CosmosService,
    private readonly configService: ConfigService,
  ) {
    this.containerName =
      this.configService.get<string>('AI_TOKEN_BUDGET_CONTAINER_NAME') ||
      'ai-token-budget';
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.initContainer();
    } catch (err) {
      this.logger.warn(
        `Failed to initialize Cosmos DB container "${this.containerName}" on startup: ${
          err instanceof Error ? err.message : String(err)
        }. Will attempt on first call.`,
      );
    }
  }

  public async initContainer(): Promise<Container> {
    if (this.container && this.isInitialized) {
      return this.container;
    }
    this.container = await this.cosmosService.ensureContainer(
      this.containerName,
      '/pk',
    );
    this.isInitialized = true;
    return this.container;
  }

  private getContainer(): Container {
    if (this.container) {
      return this.container;
    }
    return this.cosmosService.getContainer(this.containerName);
  }

  /**
   * Reads the active budget document. If it doesn't exist, initializes it.
   */
  async getActiveBudget(
    defaultLimit = 10000,
    defaultWindowHours = 24,
  ): Promise<ActiveBudgetDocument> {
    const container = this.getContainer();
    try {
      const response = await container
        .item(ACTIVE_BUDGET_DOC_ID, GLOBAL_PK)
        .read<ActiveBudgetDocument>();

      if (response.resource) {
        return {
          ...response.resource,
          _etag: response.etag,
        };
      }
    } catch (err: unknown) {
      const error = err as {
        code?: number | string;
        statusCode?: number;
        message?: string;
        stack?: string;
      };
      if (error.code !== 404 && error.statusCode !== 404) {
        this.logger.error(
          `Error reading active budget document: ${error.message || String(err)}`,
          error.stack,
        );
        throw err;
      }
    }

    // Document not found - initialize it
    const newDoc: ActiveBudgetDocument = {
      id: ACTIVE_BUDGET_DOC_ID,
      pk: GLOBAL_PK,
      budgetLimit: defaultLimit,
      windowHours: defaultWindowHours,
      generation: 1,
      buckets: {},
      reservations: {},
      processedEvents: {},
      updatedAt: new Date().toISOString(),
    };

    try {
      const createResponse = await container.items.create(newDoc);
      return {
        ...createResponse.resource!,
        _etag: createResponse.etag,
      };
    } catch (err: unknown) {
      const error = err as { code?: number | string; statusCode?: number };
      // If someone else created it concurrently (409 Conflict), re-read it
      if (error.code === 409 || error.statusCode === 409) {
        const retryResponse = await container
          .item(ACTIVE_BUDGET_DOC_ID, GLOBAL_PK)
          .read<ActiveBudgetDocument>();
        return {
          ...retryResponse.resource!,
          _etag: retryResponse.etag,
        };
      }
      throw err;
    }
  }

  /**
   * Optimistically replaces the active budget document with ETag condition.
   * Throws 412 Precondition Failed if etag has changed.
   */
  async replaceActiveBudget(
    doc: ActiveBudgetDocument,
    etag?: string,
  ): Promise<ActiveBudgetDocument> {
    const container = this.getContainer();
    const updatePayload: Record<string, unknown> = {
      ...doc,
      updatedAt: new Date().toISOString(),
    };
    delete updatePayload._etag;

    const options = etag
      ? { accessCondition: { type: 'IfMatch' as const, condition: etag } }
      : undefined;

    const response = await container
      .item(ACTIVE_BUDGET_DOC_ID, GLOBAL_PK)
      .replace<ActiveBudgetDocument>(updatePayload, options);

    return {
      ...response.resource!,
      _etag: response.etag,
    };
  }

  /**
   * Writes a detailed ledger entry for auditing and verification.
   */
  async writeLedgerEntry(entry: LedgerEntry): Promise<void> {
    try {
      const container = this.getContainer();
      await container.items.create(entry);
    } catch (err) {
      this.logger.error(
        `Failed to write ledger entry ${entry.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Non-blocking for the model call flow, but logged as error
    }
  }

  /**
   * Writes a reset audit record to Cosmos DB.
   */
  async writeResetAuditEntry(entry: ResetAuditEntry): Promise<void> {
    const container = this.getContainer();
    await container.items.create(entry);
  }
}
