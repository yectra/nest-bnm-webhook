import { registerAs } from '@nestjs/config';

export default registerAs('azure', () => ({
  openaiBaseUrl: process.env.OPENAI_BASE_URL,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL,
  openaiEmbeddingDeployment: process.env.EMBEDDING_MODEL,

  microsoftAppId: process.env.MICROSOFT_APP_ID,
  microsoftAppPassword: process.env.MICROSOFT_APP_PASSWORD,
  microsoftAppTenantId: process.env.MICROSOFT_APP_TENANT_ID,
}));
