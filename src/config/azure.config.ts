import { registerAs } from '@nestjs/config';

export default registerAs('azure', () => ({
  // Azure OpenAI configuration – replace with your actual values in .env
  openaiBaseUrl: process.env.OPENAI_BASE_URL,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModerationDeployment: process.env.OPENAI_MODERATION_DEPLOYMENT,
  openaiEmbeddingDeployment: process.env.EMBEDDING_MODEL,
  // Azure Key Vault configuration
  keyVaultUrl: process.env.AZURE_KEYVAULT_URL || process.env.KEY_VAULT_URL,
  secretName:
    process.env.AZURE_KEYVAULT_SECRET_NAME ||
    process.env.KEY_VAULT_SECRET_NAME ||
    'event-capture-security-key',
  eventSecurityKey: process.env.EVENT_SECURITY_KEY,
  // Azure Entra ID and Event Grid Webhook Authentication
  tenantId: process.env.AZURE_TENANT_ID,
  eventGridAudience: process.env.AZURE_EVENT_GRID_AUDIENCE,
  eventGridAllowedAppId: process.env.AZURE_EVENT_GRID_ALLOWED_APP_ID,
  eventGridRequiredRole: process.env.AZURE_EVENT_GRID_REQUIRED_ROLE,
  eventGridTopic: process.env.AZURE_EVENT_GRID_TOPIC,
  eventGridAllowedEventTypes: process.env.AZURE_EVENT_GRID_ALLOWED_EVENT_TYPES,
}));

