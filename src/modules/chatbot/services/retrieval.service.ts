import { Injectable, Logger } from '@nestjs/common';
import { CosmosService } from '../../database/cosmos.service';
import { SqlParameter } from '@azure/cosmos';
import { QueryPlanFilters } from 'src/common/interfaces/query-plan.interface';

export interface ContainerResult {
  container: string;
  records: any[];
  count: number;
}

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(private readonly cosmosService: CosmosService) {}

  // ──────────────────────────────────────────────
  // Generic helpers
  // ──────────────────────────────────────────────

  /**
   * Execute a parameterised Cosmos DB query against a named container.
   */
  private async query(
    containerName: string,
    sql: string,
    parameters: SqlParameter[] = [],
  ): Promise<any[]> {
    try {
      const container = this.cosmosService.getContainer(containerName);
      const { resources } = await container.items
        .query({ query: sql, parameters })
        .fetchAll();
      return resources;
    } catch (error) {
      this.logger.error(`Failed to query container "${containerName}"`, error);
      throw error;
    }
  }

  /**
   * Build a simple user-scoped query with optional status filter.
   */
  private buildUserQuery(
    fields: string,
    filters: QueryPlanFilters,
    userId: string,
    limit = 50,
  ): { sql: string; parameters: SqlParameter[] } {
    const params: SqlParameter[] = [{ name: '@userId', value: userId }];
    const conditions: string[] = ['c.userId = @userId'];

    if (filters.status) {
      conditions.push('LOWER(c.status) = LOWER(@status)');
      params.push({ name: '@status', value: filters.status });
    }

    if (filters.keyword) {
      conditions.push(
        `(CONTAINS(LOWER(c.name), LOWER(@keyword)) OR CONTAINS(LOWER(c.description), LOWER(@keyword)))`,
      );
      params.push({ name: '@keyword', value: filters.keyword });
    }

    const sql = `
      SELECT ${fields}
      FROM c
      WHERE ${conditions.join(' AND ')}
      OFFSET 0 LIMIT ${limit}
    `;

    return { sql, parameters: params };
  }

  // ──────────────────────────────────────────────
  // Category  (shared/global — no userId filter)
  // ──────────────────────────────────────────────

  /**
   * Get all categories (global, not user-scoped).
   */
  async getCategories(filters: QueryPlanFilters = {}): Promise<ContainerResult> {
    let sql = 'SELECT c.id, c.name, c.description, c.displayOrder FROM c';
    const parameters: SqlParameter[] = [];

    if (filters.keyword) {
      sql += ` WHERE CONTAINS(LOWER(c.name), LOWER(@keyword)) OR CONTAINS(LOWER(c.description), LOWER(@keyword))`;
      parameters.push({ name: '@keyword', value: filters.keyword });
    }

    sql += ' ORDER BY c.displayOrder OFFSET 0 LIMIT 100';

    const records = await this.query('Category', sql, parameters);
    return { container: 'Category', records, count: records.length };
  }

  // ──────────────────────────────────────────────
  // ContactUs
  // ──────────────────────────────────────────────

  async getContacts(
    userId: string,
    filters: QueryPlanFilters = {},
  ): Promise<ContainerResult> {
    const { sql, parameters } = this.buildUserQuery('*', filters, userId);
    const records = await this.query('ContactUs', sql, parameters);
    return { container: 'ContactUs', records, count: records.length };
  }

  // ──────────────────────────────────────────────
  // Project
  // ──────────────────────────────────────────────

  async getProjects(
    userId: string,
    filters: QueryPlanFilters = {},
  ): Promise<ContainerResult> {
    const { sql, parameters } = this.buildUserQuery(
      'c.id, c.name, c.description, c.status, c.startDate, c.endDate, c.budget',
      filters,
      userId,
    );
    const records = await this.query('Project', sql, parameters);
    return { container: 'Project', records, count: records.length };
  }

  // ──────────────────────────────────────────────
  // Quote
  // ──────────────────────────────────────────────

  async getQuotes(
    userId: string,
    filters: QueryPlanFilters = {},
  ): Promise<ContainerResult> {
    const { sql, parameters } = this.buildUserQuery(
      'c.id, c.title, c.amount, c.status, c.createdAt, c.approvedAt',
      filters,
      userId,
    );
    const records = await this.query('Quote', sql, parameters);
    return { container: 'Quote', records, count: records.length };
  }

  // ──────────────────────────────────────────────
  // Service
  // ──────────────────────────────────────────────

  async getServices(
    userId: string,
    filters: QueryPlanFilters = {},
  ): Promise<ContainerResult> {
    const { sql, parameters } = this.buildUserQuery(
      'c.id, c.name, c.description, c.status, c.price, c.category',
      filters,
      userId,
    );
    const records = await this.query('Service', sql, parameters);
    return { container: 'Service', records, count: records.length };
  }

  // ──────────────────────────────────────────────
  // Vendor
  // ──────────────────────────────────────────────

  async getVendors(
    userId: string,
    filters: QueryPlanFilters = {},
  ): Promise<ContainerResult> {
    const { sql, parameters } = this.buildUserQuery(
      'c.id, c.name, c.contactName, c.email, c.phone, c.status, c.category',
      filters,
      userId,
    );
    const records = await this.query('Vendor', sql, parameters);
    return { container: 'Vendor', records, count: records.length };
  }

  // ──────────────────────────────────────────────
  // AskOurExpert
  // ──────────────────────────────────────────────

  async getExperts(
    userId: string,
    filters: QueryPlanFilters = {},
  ): Promise<ContainerResult> {
    const { sql, parameters } = this.buildUserQuery('*', filters, userId);
    const records = await this.query('AskOurExpert', sql, parameters);
    return { container: 'AskOurExpert', records, count: records.length };
  }

  // ──────────────────────────────────────────────
  // Business Summary (all containers in parallel)
  // ──────────────────────────────────────────────

  /**
   * Fetch high-level counts and recent records from all containers
   * simultaneously. Returns an aggregated view of the user's business.
   */
  async getBusinessSummary(userId: string): Promise<ContainerResult[]> {
    const [contacts, projects, quotes, services, vendors, experts, categories] =
      await Promise.allSettled([
        this.getContacts(userId, {}),
        this.getProjects(userId, {}),
        this.getQuotes(userId, {}),
        this.getServices(userId, {}),
        this.getVendors(userId, {}),
        this.getExperts(userId, {}),
        this.getCategories({}),
      ]);

    const results: ContainerResult[] = [];

    for (const result of [contacts, projects, quotes, services, vendors, experts, categories]) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        this.logger.warn('Summary fetch failed for one container', result.reason);
      }
    }

    return results;
  }

  // ──────────────────────────────────────────────
  // Targeted multi-container query by plan
  // ──────────────────────────────────────────────

  /**
   * Route a list of container names to their specific retrieval methods.
   */
  async fetchByContainers(
    containerNames: string[],
    userId: string,
    filters: QueryPlanFilters = {},
  ): Promise<ContainerResult[]> {
    const tasks = containerNames.map((name) =>
      this.fetchSingleContainer(name, userId, filters),
    );

    const settled = await Promise.allSettled(tasks);
    const results: ContainerResult[] = [];

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        this.logger.warn('Fetch failed for container', result.reason);
      }
    }

    return results;
  }

  private async fetchSingleContainer(
    containerName: string,
    userId: string,
    filters: QueryPlanFilters,
  ): Promise<ContainerResult> {
    switch (containerName) {
      case 'Category':
        return this.getCategories(filters);
      case 'ContactUs':
        return this.getContacts(userId, filters);
      case 'Project':
        return this.getProjects(userId, filters);
      case 'Quote':
        return this.getQuotes(userId, filters);
      case 'Service':
        return this.getServices(userId, filters);
      case 'Vendor':
        return this.getVendors(userId, filters);
      case 'AskOurExpert':
        return this.getExperts(userId, filters);
      default:
        this.logger.warn(`Unknown container requested: ${containerName}`);
        return { container: containerName, records: [], count: 0 };
    }
  }
}

