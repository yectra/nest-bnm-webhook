import { Injectable, Logger } from '@nestjs/common';
import { CosmosService } from '../../database/cosmos.service';
import { SqlParameter } from '@azure/cosmos';
import { QueryPlanFilters } from '../../../common/interfaces/query-plan.interface';

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
   * Build a user-scoped query (authenticated users).
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

  /**
   * Build a general query for anonymous users — no userId filter.
   * Returns all records, optionally filtered by status/keyword.
   */
  private buildGeneralQuery(
    fields: string,
    filters: QueryPlanFilters,
    limit = 50,
  ): { sql: string; parameters: SqlParameter[] } {
    const params: SqlParameter[] = [];
    const conditions: string[] = [];

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

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT ${fields}
      FROM c
      ${whereClause}
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
  async getCategories(
    filters: QueryPlanFilters = {},
  ): Promise<ContainerResult> {
    let sql = 'SELECT  c.name, c.description FROM c';
    const parameters: SqlParameter[] = [];

    if (filters.keyword) {
      sql += ` WHERE CONTAINS(LOWER(c.name), LOWER(@keyword)) OR CONTAINS(LOWER(c.description), LOWER(@keyword))`;
      parameters.push({ name: '@keyword', value: filters.keyword });
    }

    const records = await this.query('Category', sql, parameters);
    return { container: 'Category', records, count: records.length };
  }

  // ──────────────────────────────────────────────
  // ContactUs
  // ──────────────────────────────────────────────

  /**
   * ContactUs — authenticated users only, scoped to their userId.
   */
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

  /**
   * Project — authenticated users only, scoped to their userId.
   */
  async getProjects(
    userId: string,
    filters: QueryPlanFilters = {},
  ): Promise<ContainerResult> {
    const fields =
      'c.id, c.name, c.description, c.status, c.email, c.askExpert, c.vendor';
    const { sql, parameters } = this.buildUserQuery(fields, filters, userId);
    const records = await this.query('Project', sql, parameters);
    return { container: 'Project', records, count: records.length };
  }

  // ──────────────────────────────────────────────
  // Quote
  // ──────────────────────────────────────────────

  /**
   * Quote — authenticated users only, scoped to their userId.
   */
  async getQuotes(
    userId: string,
    filters: QueryPlanFilters = {},
  ): Promise<ContainerResult> {
    const fields =
      'c.id, c.userName, c.email, c.alternateContactNumber, c.message, c.location, c.quoteStatus';
    const { sql, parameters } = this.buildUserQuery(fields, filters, userId);
    const records = await this.query('Quote', sql, parameters);
    return { container: 'Quote', records, count: records.length };
  }

  // ──────────────────────────────────────────────
  // Service
  // ──────────────────────────────────────────────

  /**
   * Service — public. Anonymous users get all services; authenticated users
   * get services scoped to their userId.
   */
  async getServices(
    userId: string | null,
    filters: QueryPlanFilters = {},
  ): Promise<ContainerResult> {
    const fields =
      'c.id, c.name, c.description, c.status, c.location, c.category';
    const { sql, parameters } = userId
      ? this.buildUserQuery(fields, filters, userId)
      : this.buildGeneralQuery(fields, filters);
    const records = await this.query('Service', sql, parameters);
    return { container: 'Service', records, count: records.length };
  }

  // ──────────────────────────────────────────────
  // Vendor
  // ──────────────────────────────────────────────

  /**
   * Vendor — authenticated users only, scoped to their userId.
   */
  async getVendors(
    userId: string,
    filters: QueryPlanFilters = {},
  ): Promise<ContainerResult> {
    const fields =
      'c.id, c.companyName, c.publicUrl, c.status, c.productServiceOfferings, c.locationOfService';
    const { sql, parameters } = this.buildUserQuery(fields, filters, userId);
    const records = await this.query('Vendor', sql, parameters);
    return { container: 'Vendor', records, count: records.length };
  }

  // ──────────────────────────────────────────────
  // AskOurExpert
  // ──────────────────────────────────────────────

  /**
   * AskOurExpert — public. Anonymous users get all experts; authenticated
   * users get experts scoped to their userId.
   */
  async getExperts(
    userId: string | null,
    filters: QueryPlanFilters = {},
  ): Promise<ContainerResult> {
    const { sql, parameters } = userId
      ? this.buildUserQuery('*', filters, userId)
      : this.buildGeneralQuery('*', filters);
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
  /**
   * Full business summary — authenticated users only.
   * Fetches from ALL containers scoped to the userId.
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

    for (const result of [
      contacts,
      projects,
      quotes,
      services,
      vendors,
      experts,
      categories,
    ]) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        this.logger.warn(
          'Summary fetch failed for one container',
          result.reason,
        );
      }
    }

    return results;
  }

  /**
   * Public summary — anonymous users only.
   * Only fetches from Service, AskOurExpert, and Category.
   */
  async getPublicSummary(): Promise<ContainerResult[]> {
    const [services, experts, categories] = await Promise.allSettled([
      this.getServices(null, {}),
      this.getExperts(null, {}),
      this.getCategories({}),
    ]);

    const results: ContainerResult[] = [];

    for (const result of [services, experts, categories]) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        this.logger.warn(
          'Public summary fetch failed for one container',
          result.reason,
        );
      }
    }

    return results;
  }

  // ──────────────────────────────────────────────
  // Targeted multi-container query by plan
  // ──────────────────────────────────────────────

  /**
   * Route a list of container names to their specific retrieval methods.
   * Private containers (ContactUs, Project, Quote, Vendor) are silently
   * skipped for anonymous users (userId = null).
   */
  async fetchByContainers(
    containerNames: string[],
    userId: string | null,
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
    userId: string | null,
    filters: QueryPlanFilters,
  ): Promise<ContainerResult> {
    // Private containers — require authentication
    const privateContainers = ['ContactUs', 'Project', 'Quote', 'Vendor'];
    if (!userId && privateContainers.includes(containerName)) {
      this.logger.warn(
        `Anonymous access denied for private container: ${containerName}`,
      );
      return { container: containerName, records: [], count: 0 };
    }

    switch (containerName) {
      case 'Category':
        return this.getCategories(filters);
      case 'ContactUs':
        return this.getContacts(userId!, filters);
      case 'Project':
        return this.getProjects(userId!, filters);
      case 'Quote':
        return this.getQuotes(userId!, filters);
      case 'Service':
        return this.getServices(userId, filters);
      case 'Vendor':
        return this.getVendors(userId!, filters);
      case 'AskOurExpert':
        return this.getExperts(userId, filters);
      default:
        this.logger.warn(`Unknown container requested: ${containerName}`);
        return { container: containerName, records: [], count: 0 };
    }
  }
}
