import { registerAs } from '@nestjs/config';

export default registerAs('azure', () => ({
  // Azure OpenAI configuration – replace with your actual values in .env
  openaiBaseUrl: process.env.OPENAI_BASE_URL,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModerationDeployment: process.env.OPENAI_MODERATION_DEPLOYMENT,
}));
