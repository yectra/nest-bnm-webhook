import { registerAs } from '@nestjs/config';

/**
 * Microsoft Fabric configuration (Epic A / A5).
 *
 * Workspace / API / model ids are recorded when the ontology is published in the
 * Fabric portal (see the A4 runbook). Auth is via an Entra app registration; the
 * secret is resolved through the environment / vault and never committed.
 */
export default registerAs('fabric', () => ({
  tenantId: process.env.FABRIC_TENANT_ID,
  clientId: process.env.FABRIC_CLIENT_ID,
  clientSecret: process.env.FABRIC_CLIENT_SECRET,
  workspaceId: process.env.FABRIC_WORKSPACE_ID,
  graphqlApiId: process.env.FABRIC_GRAPHQL_API_ID,
  graphModelId: process.env.FABRIC_GRAPH_MODEL_ID,
  baseUrl:
    process.env.FABRIC_API_BASE_URL ?? 'https://api.fabric.microsoft.com/v1',
  scope:
    process.env.FABRIC_SCOPE ??
    'https://analysis.windows.net/powerbi/api/.default',
}));
