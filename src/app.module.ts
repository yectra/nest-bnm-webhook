import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';

import appConfig from './config/app.config';
import twilioConfig from './config/twilio.config';
import azureConfig from './config/azure.config';
import databaseConfig from './config/database.config';

import { HealthModule } from './modules/health/health.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { AIModule } from './modules/ai/ai.module';
import { ChatbotModule } from './modules/chatbot/chatbot.module';
import { CosmosModule } from './modules/database/cosmos.module';
import { EmbeddingModule } from './modules/embedding/embedding.module';
import { SearchModule } from './modules/search/search.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [appConfig, twilioConfig, azureConfig, databaseConfig],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'test', 'production')
          .default('development'),
        PORT: Joi.number().port().default(3000),
        APP_BASE_URL: Joi.string().uri().optional(),
        TWILIO_ACCOUNT_SID: Joi.string().required(),
        TWILIO_AUTH_TOKEN: Joi.string().required(),
        TWILIO_WHATSAPP_NUMBER: Joi.string()
          .pattern(/^whatsapp:\+\d+$/)
          .required(),
        TWILIO_WEBHOOK_SECRET: Joi.string().optional(),
        TWILIO_STATUS_CALLBACK_URL: Joi.string().uri().optional(),
        // Azure OpenAI v1 endpoint, for example:
        // https://<resource>.openai.azure.com/openai/v1/
        OPENAI_BASE_URL: Joi.string().uri().required(),
        OPENAI_API_KEY: Joi.string().min(1).required(),
        OPENAI_MODEL: Joi.string().min(1).required(),
        // This must be the Azure deployment name, not just the base model name.
        EMBEDDING_MODEL: Joi.string().min(1).required(),
        EMBEDDING_DIMENSIONS: Joi.number()
          .integer()
          .min(1)
          .max(3072)
          .default(1536),
        OPENAI_TIMEOUT_MS: Joi.number()
          .integer()
          .min(1000)
          .max(120000)
          .default(30000),
        EMBEDDED_DOCUMENTS_CONTAINER: Joi.string()
          .min(1)
          .default('EmbeddedDocuments'),
        EMBEDDED_DOCUMENTS_PARTITION_KEY: Joi.string()
          .pattern(/^\//)
          .default('/id'),
        CHATBOT_VECTOR_TOP_K: Joi.number().integer().min(1).max(50).default(5),
        CHATBOT_VECTOR_MIN_SIMILARITY: Joi.number().min(-1).max(1).default(0.7),
        COSMOS_ENDPOINT: Joi.string().uri().required(),
        COSMOS_KEY: Joi.string().min(1).required(),
        COSMOS_DATABASE: Joi.string().min(1).required(),
        // Embedding preview/backfill routes are administrative and must never be
        // exposed without a key in production.
        API_KEY: Joi.when('NODE_ENV', {
          is: 'production',
          then: Joi.string().min(32).required(),
          otherwise: Joi.string().min(16).optional(),
        }),
      }),
    }),

    HealthModule,

    WhatsappModule,

    AIModule,

    ChatbotModule,

    CosmosModule,

    EmbeddingModule,

    SearchModule,
  ],
})
export class AppModule {}
