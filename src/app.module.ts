import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';

import appConfig from './config/app.config';
import twilioConfig from './config/twilio.config';
import azureConfig from './config/azure.config';
import databaseConfig from './config/database.config';
import microsoftGraphConfig from './config/microsoft-graph.config';
import foundryConfig from './config/foundry.config';

import { HealthModule } from './modules/health/health.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { AIModule } from './modules/ai/ai.module';
import { ChatbotModule } from './modules/chatbot/chatbot.module';
import { CosmosModule } from './modules/database/cosmos.module';
import { GraphModule } from './modules/graph/graph.module';
import { SharePointModule } from './modules/sharepoint/sharepoint.module';
import { FoundryIqModule } from './modules/foundry-iq/foundry-iq.module';

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
        microsoftGraphConfig,
        foundryConfig,
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
        MS_GRAPH_TENANT_ID: Joi.string().optional(),
        MS_GRAPH_CLIENT_ID: Joi.string().optional(),
        MS_GRAPH_CLIENT_SECRET: Joi.string().optional(),
        MS_GRAPH_BASE_URL: Joi.string().uri().optional(),
        MS_GRAPH_SCOPE: Joi.string().optional(),
        FOUNDRY_AGENT_ENDPOINT: Joi.string().uri().optional(),
        FOUNDRY_AGENT_ID: Joi.string().optional(),
        FOUNDRY_API_VERSION: Joi.string().optional(),
        FOUNDRY_TENANT_ID: Joi.string().optional(),
        FOUNDRY_CLIENT_ID: Joi.string().optional(),
        FOUNDRY_CLIENT_SECRET: Joi.string().optional(),
        FOUNDRY_SCOPE: Joi.string().optional(),
      }),
    }),

    HealthModule,

    WhatsappModule,

    AIModule,

    ChatbotModule,

    CosmosModule,

    GraphModule,

    SharePointModule,

    FoundryIqModule,
  ],
})
export class AppModule {}
