# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start Commands

### Development
- **Install dependencies**: `npm install`
- **Build**: `npm run build`
- **Type check**: `npm run type-check`
- **Start dev (watch mode)**: `npm run start:dev`
- **Start dev (debug mode)**: `npm run start:debug`
- **Start production build**: `npm run start:prod`

### Linting & Formatting
- **Lint all files**: `npm run lint`
- **Fix lint issues**: `npm run lint:fix`

### Testing
- **Run tests**: `npm test`
- **Run tests in watch mode**: `npm run test:watch`
- **Run specific test file**: `npm test -- health.service.spec.ts`
- **Generate coverage report**: `npm run test:cov`
- **Debug tests**: `npm run test:debug`
- **E2E tests**: `npm run test:e2e`

### Key Environment Setup
See `.env` file. Critical variables: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `OPENAI_API_KEY`, `COSMOS_ENDPOINT`, `COSMOS_KEY`, `API_KEY`.

## High-Level Architecture

This is a **NestJS backend** that orchestrates multiple AI and messaging capabilities:

```
┌─ HTTP/REST Endpoints (Controllers)
│  ├─ Health checks
│  ├─ Twilio WhatsApp webhooks (inbound/status)
│  ├─ Outbound message sending
│  ├─ Embeddings & semantic search
│  ├─ LangGraph agent crew chat
│  └─ Search endpoints
│
├─ WebSocket Layer (Socket.IO Gateways)
│  ├─ ChatGateway (chatbot real-time)
│  └─ AgentCrewGateway (multi-agent LangGraph crew)
│
└─ Core Service Modules
   ├─ WhatsappModule: Twilio integration
   ├─ ChatbotModule: Vector search + LLM responses + Teams notification
   ├─ AgentCrewModule: LangGraph supervisor + multi-agent orchestration
   ├─ EmbeddingModule: Azure OpenAI embeddings + backfill
   ├─ SearchModule: Cosmos vector search
   ├─ CosmosModule: Azure Cosmos DB client
   ├─ AIModule: LLM service wrapper
   └─ BotModule: Microsoft Teams bot adapter
```

## Module Organization

### `/src/modules` — Feature Modules
Each module follows NestJS patterns (controller, service, gateway). Modules are self-contained unless explicitly re-exported.

- **`health/`**: Simple health check endpoint
- **`whatsapp/`**: Twilio WhatsApp inbound/outbound message handling, signature validation
- **`chatbot/`**: Vector search + LLM chat, WebSocket gateway, Teams notifications
- **`agent-crew/`**: LangGraph multi-agent orchestration (supervisor, retrieval agents, synthesizer, PII filter, dispatcher)
- **`embedding/`**: Azure OpenAI embedding generation, backfill, administrative endpoints (protected by `x-api-key`)
- **`search/`**: Cosmos vector search queries
- **`database/`**: Cosmos DB client initialization and vector policy management
- **`ai/`**: Azure OpenAI client and LLM service wrapper
- **`bot/`**: Microsoft Teams bot adapter and proactive messaging

### `/src/common` — Shared Utilities
- **`guards/`**: API key validation, auth middleware
- **`filters/`**: Global exception handling
- **`interceptors/`**: Response transformation
- **`pipes/`**: Input validation (DTO pipes)
- **`middleware/`**: Request/response logging, Twilio signature validation
- **`decorators/`**: Custom route/parameter decorators
- **`utils/`**: Helper functions (parsing, formatting)
- **`constants/`**: Shared constants (container names, limits)
- **`enums/`**: Agent types, message status
- **`interfaces/`**: Shared TypeScript types

### `/src/config` — Environment Configuration
- **`app.config.ts`**: App-level settings (port, env)
- **`twilio.config.ts`**: Twilio credentials
- **`azure.config.ts`**: Azure OpenAI and Cosmos DB endpoints
- **`database.config.ts`**: Cosmos database name

Configuration is validated with Joi schemas in `app.module.ts`.

## Key Architectural Patterns

### 1. **Agent Crew (LangGraph Multi-Agent Orchestration)**
Located in `modules/agent-crew/`, this implements a structured multi-agent workflow:
- **Supervisor** (GPT-5): Plans which agents to invoke
- **Retrieval Agents** (parallel): Service vector search, quote retrieval, image analysis
- **Synthesizer** (GPT-5): Combines retrieved context into an answer
- **PII Filter**: Redacts sensitive data (regex + optional LLM review)
- **Dispatcher**: Sends result to Teams channel + WebSocket clients

The graph is **registry-driven**: agents are registered in the `CREW_AGENTS` token. Adding a crew member requires implementing `CrewAgentDefinition` and registering it; graph nodes and supervisor prompt are auto-derived.

### 2. **Vector Embedding & Semantic Search**
- Azure OpenAI embeddings are generated on-write (via `EmbeddingWriteService`)
- Vectors are stored in Cosmos DB containers with a `/embedding` float32 policy
- Semantic search queries use `SearchModule` (Cosmos vector search)
- Chatbot uses vector retrieval (configurable top-k and similarity threshold) with no keyword fallback

### 3. **Real-Time Communication**
- **Chatbot**: Socket.IO namespace `/api/chatbot` → `ChatGateway`
- **Agent Crew**: Socket.IO namespace `/api/agent-crew` → `AgentCrewGateway`
- Clients join a session, emit queries, receive `crewResponse` or `chatResponse` events

### 4. **Twilio WhatsApp Integration**
- Inbound webhook: `/api/webhook/whatsapp` validates Twilio signature, queues auto-reply
- Outbound: `/api/twilio/send-message` sends via Twilio, attaches status callback URL
- Status webhook: `/api/webhook/whatsapp/status` updates message delivery state
- All requests include Twilio signature validation middleware

### 5. **Cosmos DB Organization**
Containers by purpose:
- **EmbeddedDocuments**: Searchable projection (contains embeddings + source metadata)
- **Service, Vendor, Category, Quote, PostYourRequirements**: Core data (may have embeddings added)
- All use `/id` partition key for query efficiency

## Testing Strategy

- **Unit tests** (`*.spec.ts`) live next to source files; test a single service/controller
- **Jest configuration** in `package.json`: transforms TypeScript, uses ts-jest, looks for `*.spec.ts` in `src/`
- **E2E tests** in `/test` directory; use separate Jest config
- Use `@nestjs/testing` utilities (Test.createTestingModule, TestingModule)
- Mock external dependencies (Cosmos, Azure OpenAI, Twilio) in unit tests

## Important Conventions

- **Dependency injection**: Use NestJS constructor injection; avoid singletons
- **Global pipes/guards**: Defined in `main.ts` as `ValidationPipe` with `whitelist: true`
- **API prefix**: All routes are prefixed with `/api`
- **Swagger docs**: Available at `/docs` (configured in `main.ts`)
- **Error handling**: Global exception filter catches all errors; log and return structured JSON
- **CORS**: Enabled with `origin: '*'`
- **Trust proxy**: Set to 1 for Azure App Service behind load balancer

## Environment-Specific Behavior

- **Production (`NODE_ENV=production`)**:
  - `API_KEY` must be ≥32 characters (guards embedding endpoints)
  - Build runs before deployment: `npm run build`
  - Served from `./build` directory
- **Development**:
  - `API_KEY` optional or ≥16 characters
  - Run with `npm run start:dev` for hot-reload
  - Cosmos DB and Azure OpenAI are live (not mocked)

## Known Constraints & Gotchas

1. **Cosmos vector policy is immutable**: Cannot add embeddings to existing containers. Must recreate with policy in `src/modules/database/vector-policy.ts`.
2. **Embedding dimensions must match**: All embeddings across all containers must use same dimension (default 1536).
3. **No keyword fallback**: If Cosmos vector search returns no results above threshold, chatbot responds "No relevant information found" (no fallback to keyword search).
4. **Twilio signature validation**: Inbound webhook requests are validated with `TWILIO_AUTH_TOKEN`; signature format is Twilio-specific (not a shared secret).
5. **Session routing**: Chatbot and agent crew sessions use socket IDs; ensure client explicitly joins a session before sending messages.
6. **PII filter is deterministic**: Regex redaction is consistent; LLM review is optional and adds latency.

## Debugging Tips

- **Inspect LLM calls**: Check `OPENAI_TIMEOUT_MS` (default 30s) and Azure OpenAI rate limits
- **Vector search returning nothing**: Verify container has embeddings, check similarity threshold (`CHATBOT_VECTOR_MIN_SIMILARITY` default 0.7)
- **Twilio validation fails**: Ensure `TWILIO_AUTH_TOKEN` is correct and request body is unmodified
- **Teams proactive messaging fails**: Verify bot is installed in target channel and `botId` environment variable is set
- **Socket.IO connection issues**: Check browser console for CORS errors; verify `/api` prefix is not duplicated
