# BNM Webhook Backend

NestJS backend for:

- Twilio WhatsApp inbound webhook handling
- Automatic WhatsApp replies
- Outbound message sending
- Twilio message status callbacks
- Azure App Service deployment

## Local setup

```bash
npm install
npm run build
npm run start
```

The API starts on `http://localhost:3000` by default.

Useful endpoints:

- `GET /api/health`
- `POST /api/twilio/send-message`
- `POST /api/webhook/whatsapp`
- `POST /api/webhook/whatsapp/status`
- `GET /docs`

## Required environment variables

Create a `.env` file with:

```env
PORT=3000
NODE_ENV=development
APP_BASE_URL=https://your-app-name.azurewebsites.net
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
TWILIO_STATUS_CALLBACK_URL=https://your-app-name.azurewebsites.net/api/webhook/whatsapp/status
TWILIO_WEBHOOK_SECRET=optional_shared_secret
OPENAI_BASE_URL=https://your-resource.openai.azure.com/openai/v1/
OPENAI_API_KEY=your_azure_openai_key
OPENAI_MODEL=your_chat_deployment_name
EMBEDDING_MODEL=your_embedding_deployment_name
EMBEDDING_DIMENSIONS=1536
OPENAI_TIMEOUT_MS=30000
COSMOS_ENDPOINT=https://your-account.documents.azure.com:443/
COSMOS_KEY=your_cosmos_key
COSMOS_DATABASE=your_database_name
API_KEY=a-long-random-administrative-api-key
```

Notes:

- `APP_BASE_URL` should be your public Azure App Service URL.
- `TWILIO_STATUS_CALLBACK_URL` is used when this app sends outbound WhatsApp messages.
- `TWILIO_WEBHOOK_SECRET` is optional. Real Twilio requests are validated with the Twilio auth token.
- `EMBEDDING_MODEL` must be the Azure deployment name. `text-embedding-3-small`
  should use 1536 dimensions; all Cosmos vector containers must use the same value.

## Embeddings and semantic search

The embedding routes are protected by `x-api-key`; set `API_KEY` before using
them. First verify the Azure deployment:

```bash
curl -X POST http://localhost:3000/api/embeddings/preview \
  -H "x-api-key: $API_KEY" -H "content-type: application/json" \
  -d '{"text":"modular kitchen vendors in Chennai"}'
```

It returns the vector dimension without exposing the vector itself. Then
back-fill one catalog container at a time. Repeat until `embedded` is zero:

```bash
curl -X POST http://localhost:3000/api/embeddings/backfill \
  -H "x-api-key: $API_KEY" -H "content-type: application/json" \
  -d '{"container":"Service","limit":25}'
```

To create a new test catalog item and its embedding in one request, use:

```bash
curl -X POST http://localhost:3000/api/embeddings/documents \
  -H "x-api-key: $API_KEY" -H "content-type: application/json" \
  -d '{"container":"Service","document":{"id":"service-demo-001","name":"Modular kitchen installation","description":"Custom modular kitchens in Chennai","category":"Interior Design","location":"Chennai"}}'
```

For a newly created container this endpoint provisions a `/id` partition key
and the required vector policy. It does not alter the immutable policy of an
existing container.

Finally query the populated catalog:

```bash
curl -X POST http://localhost:3000/api/search/semantic \
  -H "content-type: application/json" \
  -d '{"query":"modular kitchen vendors in Chennai","containers":["Service"],"top":5}'
```

Important: Cosmos DB vector embedding policies cannot be added to an existing
container. Existing `Service`, `Vendor`, `Category`, and `AskOurExpert`
containers must be recreated/migrated with the `/embedding` float32 cosine
DiskANN policy in `src/modules/database/vector-policy.ts`, then back-filled.

The chatbot searches only the configured `EMBEDDED_DOCUMENTS_CONTAINER`
(default: `EmbeddedDocuments`). The document creation and backfill endpoints
maintain this searchable projection automatically; its records contain source
metadata, source data, and the embedding used by Cosmos vector search.

Configure chatbot retrieval with `CHATBOT_VECTOR_TOP_K` (default `5`) and
`CHATBOT_VECTOR_MIN_SIMILARITY` (default `0.7`). The chatbot does not run a
keyword fallback: if native Cosmos vector search returns no result above the
threshold, it responds with `No relevant information found.`

## WhatsApp deep agent (hello world)

`GET/POST /api/hello-agent` runs one turn of a [deep agent]
(https://github.com/langchain-ai/deepagentsjs) built with `createDeepAgent`
on `@langchain/langgraph`, using a LOW-COST OpenAI-compatible endpoint:

```env
WHATSAPP_AGENT_LLM_BASE_URL=https://your-low-cost-endpoint/v1
WHATSAPP_AGENT_LLM_API_KEY=your-key
WHATSAPP_AGENT_LLM_MODEL=phi-4-mini-instruct
```

All three are optional: with no base URL configured the endpoint returns a
static reply instead of failing (the module is designed to fail open).
Frontier models are never required. Later increments add the Event Grid
consumer that answers inbound WhatsApp messages
(`BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT`), the grounded support agent, the
adversarial-input guard, and the PII output filter.

## LangGraph agent crew

`POST /api/agent-crew/chat` (and the Socket.IO namespace `api/agent-crew`)
runs a LangGraph crew of agents backed by the GPT-5 deployment on Azure AI
Foundry and Cosmos DB vector search:

1. **Supervisor** (GPT-5) plans which retrieval agents to run.
2. **Service vector agent** searches the service catalog vectors.
3. **Quote agent** retrieves the user's quotes (vector matches plus most
   recent quote documents).
4. **Image agent** collects pictures attached to Quote and
   Post Your Requirements documents and analyzes them with GPT-5 vision.
   Disabled by default; enable with `AGENT_CREW_IMAGE_AGENT_ENABLED=true`.
5. **Synthesizer** (GPT-5) composes the answer from the retrieved context.
6. **PII filter** redacts emails, phone numbers, card/ID numbers with a
   deterministic regex pass plus an optional GPT-5 review pass
   (`AGENT_CREW_PII_LLM_REVIEW=false` to disable).
7. **Dispatcher** sends the filtered answer to the Microsoft Teams channel
   (proactive card) and emits `crewResponse` to WebSocket clients.

The retrieval agents selected by the supervisor run in parallel and fan back
in at the synthesizer.

The orchestrator is registry-driven: each retrieval agent implements
`CrewAgentDefinition` (node name, plan flag, planning hint, enable switch,
keyword heuristic, and the node body) and is registered under the
`CREW_AGENTS` token in `agent-crew.module.ts`. The graph nodes, supervisor
planning prompt, and routing are all derived from that registry, so adding a
crew member is one class plus one registry entry — the graph factory,
supervisor, and prompts never change. The tail
(`synthesize -> piiFilter -> dispatchAgent`) is deliberately fixed so no
answer can skip PII filtering. Backbone prompts live in
`src/modules/agent-crew/prompts/crew.prompts.ts`.

WebSocket usage (Socket.IO):

```js
const socket = io('https://your-app/api/agent-crew');
socket.emit('joinSession', { sessionId: 'conv-1' });
socket.on('crewResponse', (payload) => console.log(payload));
socket.emit('askCrew', { message: 'Find services matching the pictures on my quote', conversationId: 'conv-1', userId: 'user-789' });
```

Configuration: `AGENT_CREW_MODEL` (GPT-5 deployment name, defaults to
`OPENAI_MODEL`), `AGENT_CREW_TOP_K`,
`AGENT_CREW_IMAGE_AGENT_ENABLED` (default `false`), `AGENT_CREW_MAX_IMAGES`,
`AGENT_CREW_QUOTE_CONTAINER`, `AGENT_CREW_REQUIREMENTS_CONTAINER`,
`AGENT_CREW_PII_LLM_REVIEW`.

## Twilio WhatsApp configuration

In the Twilio console for your WhatsApp sender:

1. Set the incoming message webhook URL to:

```text
https://your-app-name.azurewebsites.net/api/webhook/whatsapp
```

2. Set the method to `POST`.

3. For status callbacks, use:

```text
https://your-app-name.azurewebsites.net/api/webhook/whatsapp/status
```

## Azure App Service deployment

### 1. Create the App Service resources

```bash
az group create --name bnm-webhook-rg --location centralindia
az appservice plan create --name bnm-webhook-plan --resource-group bnm-webhook-rg --sku B1 --is-linux
az webapp create --name <your-unique-app-name> --resource-group bnm-webhook-rg --plan bnm-webhook-plan --runtime "NODE:22-lts"
```

### 2. Configure app settings

```bash
az webapp config appsettings set \
  --name <your-unique-app-name> \
  --resource-group bnm-webhook-rg \
  --settings \
  NODE_ENV=production \
  SCM_DO_BUILD_DURING_DEPLOYMENT=true \
  PORT=8080 \
  APP_BASE_URL=https://<your-unique-app-name>.azurewebsites.net \
  TWILIO_ACCOUNT_SID=<value> \
  TWILIO_AUTH_TOKEN=<value> \
  TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886 \
  TWILIO_STATUS_CALLBACK_URL=https://<your-unique-app-name>.azurewebsites.net/api/webhook/whatsapp/status
```

### 3. Deploy the code

```bash
az webapp deployment source config-local-git \
  --name <your-unique-app-name> \
  --resource-group bnm-webhook-rg
```

Then push your repo to the Git remote returned by Azure, or use a ZIP deployment:

```bash
az webapp deploy \
  --name <your-unique-app-name> \
  --resource-group bnm-webhook-rg \
  --src-path .
```

## Runtime behavior

- Inbound WhatsApp messages hit `/api/webhook/whatsapp`.
- The app validates the Twilio request signature.
- It responds immediately with TwiML, so Twilio sends the auto-reply back to the user.
- Outbound messages sent through `/api/twilio/send-message` include the configured status callback URL.
- Twilio delivery updates are received on `/api/webhook/whatsapp/status`.
