/**
 * Containers exposed to public semantic search (Epic A / A3).
 *
 * The public marketplace catalog — the natural discovery surface. User-scoped
 * containers (Project, Quote, ContactUs) are intentionally excluded from the
 * public endpoint.
 */
export const SEARCHABLE_CONTAINERS = [
  'Service',
  'Vendor',
  'Category',
  'AskOurExpert',
] as const;

export type SearchableContainer = (typeof SEARCHABLE_CONTAINERS)[number];

/** Default number of results returned by a semantic search. */
export const DEFAULT_SEARCH_TOP = 10;

/** Hard cap on results per request. */
export const MAX_SEARCH_TOP = 50;
