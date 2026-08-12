import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  // Deployment environment (dev, stage, main). "main" disables all API access.
  appEnv: process.env.APP_ENV || 'dev',
  port: parseInt(process.env.PORT || '3000', 10),
  baseUrl: process.env.APP_BASE_URL,
}));
