import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';

import appConfig from './config/app.config';
import azureConfig from './config/azure.config';
import databaseConfig from './config/database.config';

import { ChatModule } from './chat/chat.module';
import { AiModule } from './ai/ai.module';
import { RetrievalModule } from './retrieval/retrieval.module';
import { TeamsModule } from './teams/teams.module';
import { ConversationModule } from './conversation/conversation.module';
import { WebsocketModule } from './websocket/websocket.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [appConfig, azureConfig, databaseConfig],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'test', 'production')
          .default('development'),
        PORT: Joi.number().port().default(3000),

        // Azure OpenAI
        OPENAI_BASE_URL: Joi.string().uri().required(),
        OPENAI_API_KEY: Joi.string().min(1).required(),
        OPENAI_MODEL: Joi.string().min(1).required(),
        EMBEDDING_MODEL: Joi.string().min(1).required(),

        // Cosmos DB
        COSMOS_ENDPOINT: Joi.string().uri().required(),
        COSMOS_KEY: Joi.string().min(1).required(),
        COSMOS_DATABASE: Joi.string().min(1).required(),

        // Bot Framework / Teams
        MICROSOFT_APP_ID: Joi.string().optional(),
        MICROSOFT_APP_PASSWORD: Joi.string().optional(),
        MICROSOFT_APP_TENANT_ID: Joi.string().optional(),
      }),
    }),

    ChatModule,
    AiModule,
    RetrievalModule,
    TeamsModule,
    ConversationModule,
    WebsocketModule,
  ],
})
export class AppModule {}
