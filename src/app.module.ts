import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';

import appConfig from './config/app.config';
import twilioConfig from './config/twilio.config';
import azureConfig from './config/azure.config';
import databaseConfig from './config/database.config';
import fabricConfig from './config/fabric.config';

import { HealthModule } from './modules/health/health.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { AIModule } from './modules/ai/ai.module';
import { ChatbotModule } from './modules/chatbot/chatbot.module';
import { CosmosModule } from './modules/database/cosmos.module';
import { EmbeddingModule } from './modules/embedding/embedding.module';
import { SearchModule } from './modules/search/search.module';
import { FabricIqModule } from './modules/fabric-iq/fabric-iq.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [
        appConfig,
        twilioConfig,
        azureConfig,
        databaseConfig,
        fabricConfig,
      ],
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
        EMBEDDING_MODEL: Joi.string().optional(),
        FABRIC_TENANT_ID: Joi.string().optional(),
        FABRIC_CLIENT_ID: Joi.string().optional(),
        FABRIC_CLIENT_SECRET: Joi.string().optional(),
        FABRIC_WORKSPACE_ID: Joi.string().optional(),
        FABRIC_GRAPHQL_API_ID: Joi.string().optional(),
        FABRIC_GRAPH_MODEL_ID: Joi.string().optional(),
        FABRIC_API_BASE_URL: Joi.string().uri().optional(),
        FABRIC_SCOPE: Joi.string().optional(),
      }),
    }),

    HealthModule,

    WhatsappModule,

    AIModule,

    ChatbotModule,

    CosmosModule,

    EmbeddingModule,

    SearchModule,

    FabricIqModule,
  ],
})
export class AppModule {}
