import { registerAs } from '@nestjs/config';

/**
 * Microsoft Graph configuration (Epic B / B1).
 *
 * Auth is via an Entra app registration (service principal). When a client
 * id/secret/tenant are provided a `ClientSecretCredential` is used; otherwise the
 * `GraphClientService` falls back to `DefaultAzureCredential` (managed identity).
 * The secret is resolved through the environment / vault and never committed.
 */
export default registerAs('microsoftGraph', () => ({
  tenantId: process.env.MS_GRAPH_TENANT_ID,
  clientId: process.env.MS_GRAPH_CLIENT_ID,
  clientSecret: process.env.MS_GRAPH_CLIENT_SECRET,
  baseUrl: process.env.MS_GRAPH_BASE_URL ?? 'https://graph.microsoft.com/v1.0',
  scope: process.env.MS_GRAPH_SCOPE ?? 'https://graph.microsoft.com/.default',
}));
