import { registerAs } from '@nestjs/config';

/**
 * Foundry IQ agent configuration (Epic B / B3).
 *
 * The agent is created in the Foundry portal and grounded on the unified
 * knowledge base (SharePoint documents from B2 + the Fabric IQ ontology from
 * A5). The app calls its REST endpoint. Auth is via an Entra app registration;
 * the secret is resolved through the environment / vault and never committed.
 */
export default registerAs('foundry', () => ({
  /** Full REST invoke URL of the Foundry agent (from the portal). */
  endpoint: process.env.FOUNDRY_AGENT_ENDPOINT,
  agentId: process.env.FOUNDRY_AGENT_ID,
  apiVersion: process.env.FOUNDRY_API_VERSION,
  tenantId: process.env.FOUNDRY_TENANT_ID,
  clientId: process.env.FOUNDRY_CLIENT_ID,
  clientSecret: process.env.FOUNDRY_CLIENT_SECRET,
  scope: process.env.FOUNDRY_SCOPE ?? 'https://ai.azure.com/.default',
}));
