import { KnowledgeDomain } from '../enums/knowledge-domain.enum';

export interface AuthorizationResult {
  allowed: boolean;
  domain: KnowledgeDomain;
  reason?: string;
  userId?: string;
  tenantId?: string;
}
