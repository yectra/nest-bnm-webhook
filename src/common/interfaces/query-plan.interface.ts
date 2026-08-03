export interface QueryPlanFilters {
  /** Status filter e.g. "pending", "active", "completed", "approved" */
  status?: string;

  /** Keyword for text search */
  keyword?: string;

  /** Date range filter */
  dateRange?: {
    from: string;
    to: string;
  };
}

export interface QueryPlan {
  /** One or more Cosmos DB containers to query */
  containers: string[];

  /** The type of operation to perform */
  operation: 'LIST' | 'SEARCH' | 'SUMMARY';

  /** Additional filters to apply on the query */
  filters: QueryPlanFilters;

  /** Maximum number of records to retrieve (default: 50) */
  limit?: number;
}
