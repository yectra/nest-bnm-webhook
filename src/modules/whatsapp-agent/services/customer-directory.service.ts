import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CosmosService } from '../../database/cosmos.service';

export interface CustomerNamesResult {
  names: string[];
  /** Documents read from Cosmos before de-duplication. */
  scanned: number;
  container: string;
  /** Populated when the lookup failed — the agent degrades, never crashes. */
  error?: string;
}

/** Document fields, in priority order, that may hold a customer's name. */
const NAME_FIELDS = [
  'customerName',
  'contactName',
  'fullName',
  'name',
  'userName',
  'clientName',
  'requesterName',
] as const;

/** Nested objects searched for the same fields when the top level has none. */
const NESTED_FIELDS = ['customer', 'contact', 'user', 'client'] as const;

/**
 * Exactly the fields the projection reads. Selecting these instead of `*`
 * keeps embedding vectors and attachment payloads out of the response.
 */
const PROJECTION_FIELDS = [
  'id',
  ...NAME_FIELDS,
  'firstName',
  'lastName',
  ...NESTED_FIELDS,
] as const;

/**
 * Reads customer names out of the Post Your Requirements container. Backs the
 * deep agent's `list_customer_names` tool, and doubles as the deterministic
 * answer path when no LLM is configured.
 */
@Injectable()
export class CustomerDirectoryService {
  private readonly logger = new Logger(CustomerDirectoryService.name);

  constructor(
    private readonly cosmosService: CosmosService,
    private readonly configService: ConfigService,
  ) {}

  getContainerName(): string {
    return (
      this.configService.get<string>('whatsappAgent.requirements.container') ||
      'PostYourRequirements'
    );
  }

  private getMaxCustomers(): number {
    const configured = this.configService.get<number>(
      'whatsappAgent.requirements.maxCustomers',
    );
    return Number.isFinite(configured) ? Number(configured) : 200;
  }

  /**
   * Distinct customer names, most recently written first. Never throws: a
   * Cosmos outage returns an empty list plus the error string, which the agent
   * turns into an honest "could not read the directory" answer.
   */
  async listCustomerNames(limit?: number): Promise<CustomerNamesResult> {
    const container = this.getContainerName();
    // TOP takes a literal, so the bound is clamped to a safe integer here
    // rather than interpolated straight from configuration or agent input.
    const cap = Math.min(
      Math.max(Math.trunc(limit ?? this.getMaxCustomers()) || 0, 1),
      this.getMaxCustomers(),
    );

    try {
      const projection = PROJECTION_FIELDS.map((field) => `c.${field}`).join(
        ', ',
      );
      const query = `SELECT TOP ${cap} ${projection} FROM c ORDER BY c._ts DESC`;

      const { resources } = await this.cosmosService
        .getContainer(container)
        .items.query<Record<string, unknown>>(query)
        .fetchAll();

      const names = this.extractNames(resources ?? []);
      this.logger.log(
        `Customer directory: ${resources?.length ?? 0} ${container} documents -> ${names.length} distinct names`,
      );
      return { names, scanned: resources?.length ?? 0, container };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Customer directory lookup failed on "${container}": ${message}`,
      );
      return { names: [], scanned: 0, container, error: message };
    }
  }

  private extractNames(documents: Record<string, unknown>[]): string[] {
    const seen = new Set<string>();
    const names: string[] = [];

    for (const document of documents) {
      const name = this.readName(document);
      if (!name) {
        continue;
      }
      const key = name.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      names.push(name);
    }

    return names;
  }

  private readName(document: Record<string, unknown>): string | undefined {
    const direct = this.readNameFields(document);
    if (direct) {
      return direct;
    }

    for (const field of NESTED_FIELDS) {
      const nested = document[field];
      if (nested && typeof nested === 'object') {
        const name = this.readNameFields(nested as Record<string, unknown>);
        if (name) {
          return name;
        }
      }
    }

    return undefined;
  }

  private readNameFields(source: Record<string, unknown>): string | undefined {
    for (const field of NAME_FIELDS) {
      const value = source[field];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    const first = source.firstName;
    const last = source.lastName;
    const combined = [first, last]
      .filter(
        (part): part is string => typeof part === 'string' && !!part.trim(),
      )
      .join(' ')
      .trim();

    return combined || undefined;
  }
}
