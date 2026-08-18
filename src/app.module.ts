import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import * as Joi from 'joi';

import { MainEnvBlockGuard } from './common/guards/main-env-block.guard';

import appConfig from './config/app.config';
import twilioConfig from './config/twilio.config';
import azureConfig from './config/azure.config';
import databaseConfig from './config/database.config';
import whatsappAgentConfig from './config/whatsapp-agent.config';
import internalEventsConfig from './config/internal-events.config';
import eventListenerConfig from './config/event-listener.config';

import { HealthModule } from './modules/health/health.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { AIModule } from './modules/ai/ai.module';
import { ChatbotModule } from './modules/chatbot/chatbot.module';
import { CosmosModule } from './modules/database/cosmos.module';
import { BotModule } from './modules/bot/bot.module';
import { EmbeddingModule } from './modules/embedding/embedding.module';
import { SearchModule } from './modules/search/search.module';
import { AgentCrewModule } from './modules/agent-crew/agent-crew.module';
import { WhatsappAgentModule } from './modules/whatsapp-agent/whatsapp-agent.module';
import { InternalEventsModule } from './modules/internal-events/internal-events.module';

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
        whatsappAgentConfig,
        internalEventsConfig,
        eventListenerConfig,
      ],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'test', 'production')
          .default('development'),
        // Deployment environment matching the branch/slot (dev, stage, main).
        // Defaults to "main", which blocks all API calls and public endpoints;
        // set APP_ENV=dev or APP_ENV=stage to enable the API.
        APP_ENV: Joi.string().valid('dev', 'stage', 'main').default('main'),
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
        // Agent crew (LangGraph): GPT-5 deployment name on Azure AI Foundry.
        // Falls back to OPENAI_MODEL when not set.
        AGENT_CREW_MODEL: Joi.string().min(1).optional(),
        AGENT_CREW_TOP_K: Joi.number().integer().min(1).max(50).default(5),
        // Picture analysis (GPT-5 vision) is opt-in: the image agent never
        // runs unless this is explicitly set to true.
        AGENT_CREW_IMAGE_AGENT_ENABLED: Joi.boolean().default(false),
        AGENT_CREW_MAX_IMAGES: Joi.number().integer().min(1).max(10).default(4),
        AGENT_CREW_QUOTE_CONTAINER: Joi.string().min(1).default('Quote'),
        AGENT_CREW_REQUIREMENTS_CONTAINER: Joi.string()
          .min(1)
          .default('PostYourRequirements'),
        AGENT_CREW_PII_LLM_REVIEW: Joi.boolean().default(true),
        CHATBOT_VECTOR_MIN_SIMILARITY: Joi.number().min(-1).max(1).default(0.7),
        COSMOS_ENDPOINT: Joi.string().uri().required(),
        COSMOS_KEY: Joi.string().min(1).required(),
        COSMOS_DATABASE: Joi.string().min(1).required(),
        // WhatsApp Agent LLM optional config
        WHATSAPP_AGENT_LLM_BASE_URL: Joi.string().uri().optional(),
        WHATSAPP_AGENT_LLM_API_KEY: Joi.string().optional(),
        WHATSAPP_AGENT_LLM_MODEL: Joi.string().optional(),
        // Internal-only event listener (/api/internal/events/*). Disabled by
        // default; when enabled it is reachable from Azure-internal callers
        // only and requires INTERNAL_EVENTS_KEY.
        INTERNAL_EVENTS_ENABLED: Joi.boolean().default(false),
        INTERNAL_EVENTS_KEY: Joi.when('INTERNAL_EVENTS_ENABLED', {
          is: true,
          then: Joi.string().min(32).required(),
          otherwise: Joi.string().min(32).optional(),
        }),
        // Comma-separated CIDRs allowed on top of the built-in private ranges,
        // for example the subnet behind a private endpoint.
        INTERNAL_EVENTS_ALLOWED_CIDRS: Joi.string().allow('').optional(),
        INTERNAL_EVENTS_ALLOWED_ORIGIN: Joi.string()
          .min(1)
          .default('eventgrid.azure.net'),
        // Pull-based event listener (Azure Service Bus). No controller and no
        // inbound port: it only opens outbound connections.
        EVENT_LISTENER_ENABLED: Joi.boolean().default(false),
        EVENT_LISTENER_CONNECTION_STRING: Joi.string().optional(),
        // Fully qualified namespace, e.g. <name>.servicebus.windows.net.
        // Used with managed identity when no connection string is set.
        EVENT_LISTENER_NAMESPACE: Joi.string().optional(),
        EVENT_LISTENER_QUEUE: Joi.string().optional(),
        EVENT_LISTENER_TOPIC: Joi.string().optional(),
        EVENT_LISTENER_SUBSCRIPTION: Joi.string().optional(),
        EVENT_LISTENER_MAX_CONCURRENT: Joi.number()
          .integer()
          .min(1)
          .max(100)
          .default(1),
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

    BotModule,

    EmbeddingModule,

    SearchModule,

    AgentCrewModule,
    WhatsappAgentModule,

    InternalEventsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: MainEnvBlockGuard,
    },
  ],
})
export class AppModule {}
