import { registerAs } from '@nestjs/config';

export default registerAs('azure', () => ({
  // Azure OpenAI configuration
  openaiBaseUrl: process.env.OPENAI_BASE_URL,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL,
  openaiTextModel: process.env.OPENAI_TEXT_MODEL,
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL,
  openaiEvaluationModel: process.env.OPENAI_EVALUATION_MODEL,
  agentCrewModel: process.env.AGENT_CREW_MODEL,
  whatsappAgentModel: process.env.WHATSAPP_AGENT_LLM_MODEL,
  embeddingModel: process.env.EMBEDDING_MODEL,
  /** Deprecated alias — use embeddingModel */
  openaiEmbeddingDeployment: process.env.EMBEDDING_MODEL,

  // Obsolete — superseded by openaiTextModel
  openaiModerationDeployment: process.env.OPENAI_MODERATION_DEPLOYMENT,

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

  // Configurable Business Event Grid Event Types
  eventGridEventTypesRequirements: process.env.EVENT_GRID_EVENT_TYPES_REQUIREMENTS,
  eventGridEventTypesQuotes: process.env.EVENT_GRID_EVENT_TYPES_QUOTES,
  eventGridEventTypesWhatsApp: process.env.EVENT_GRID_EVENT_TYPES_WHATSAPP,
}));

