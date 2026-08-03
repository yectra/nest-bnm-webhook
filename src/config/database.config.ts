import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY,
  database: process.env.COSMOS_DATABASE,
}));
