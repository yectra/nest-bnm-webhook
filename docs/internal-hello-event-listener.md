# Internal "hello world" event listener

A "hello world" event listener that is **not reachable from the public
internet**. Two implementations share `HelloEventService`; both are off by
default, so pick the one that matches the producer.

| | Option A: pull-based listener | Option B: HTTP webhook |
| --- | --- | --- |
| Class | `HelloEventListener` (provider, no controller) | `HelloEventController` |
| Surface | none — outbound connection only | `/api/internal/events/hello` |
| Protection | nothing inbound to protect | `AzureInternalGuard` + Azure network controls |
| Delivery | Event Grid → Service Bus → app pulls | Event Grid → app (push) |
| Switch | `EVENT_LISTENER_ENABLED` | `INTERNAL_EVENTS_ENABLED` |

Files:

- `src/modules/internal-events/services/hello-event.listener.ts` (option A)
- `src/modules/internal-events/controllers/hello-event.controller.ts` (option B)
- `src/modules/internal-events/services/hello-event.service.ts` (shared)
- `src/common/guards/azure-internal.guard.ts`
- `src/config/event-listener.config.ts`, `src/config/internal-events.config.ts`

---

# Option A — pull-based listener, no controller

`HelloEventListener` is an `@Injectable()` provider implementing `OnModuleInit`
/ `OnModuleDestroy`. Nothing maps it to a route, so the app exposes **no HTTP
surface for it at all**: it opens an outbound connection to Azure Service Bus
and receives from there. That is the strongest form of "internal only" — there
is no inbound port to restrict, no key on the request path, and the app can run
with `publicNetworkAccess=Disabled`.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `EVENT_LISTENER_ENABLED` | no | `false` | Turns the listener on. While `false` it never connects. |
| `EVENT_LISTENER_NAMESPACE` | one of these two | – | Fully qualified namespace, e.g. `contoso.servicebus.windows.net`. Used with managed identity. |
| `EVENT_LISTENER_CONNECTION_STRING` | one of these two | – | Connection string, for environments without managed identity. |
| `EVENT_LISTENER_QUEUE` | queue *or* topic pair | – | Queue to receive from. |
| `EVENT_LISTENER_TOPIC` / `EVENT_LISTENER_SUBSCRIPTION` | queue *or* topic pair | – | Topic subscription to receive from. |
| `EVENT_LISTENER_MAX_CONCURRENT` | no | `1` | Concurrent message handlers. |

Enabled but misconfigured, the listener logs an error and stays idle rather than
taking the whole App Service down.

## Azure setup

```bash
# 1. Queue for the events.
az servicebus queue create -g <rg> --namespace-name <ns> --name hello-events

# 2. Let the App Service identity receive from it — no secret to store.
az webapp identity assign -g <rg> -n <app>
az role assignment create \
  --assignee $(az webapp identity show -g <rg> -n <app> --query principalId -o tsv) \
  --role "Azure Service Bus Data Receiver" \
  --scope $(az servicebus queue show -g <rg> --namespace-name <ns> -n hello-events --query id -o tsv)

# 3. Deliver events to the queue instead of a webhook.
az eventgrid event-subscription create \
  --name hello-internal \
  --source-resource-id <topic-or-source-id> \
  --endpoint-type servicebusqueue \
  --endpoint $(az servicebus queue show -g <rg> --namespace-name <ns> -n hello-events --query id -o tsv)

# 4. App settings.
az webapp config appsettings set -g <rg> -n <app> --settings \
  EVENT_LISTENER_ENABLED=true \
  EVENT_LISTENER_NAMESPACE=<ns>.servicebus.windows.net \
  EVENT_LISTENER_QUEUE=hello-events
```

With no public ingress needed, the app itself can be closed off entirely:

```bash
az webapp update -g <rg> -n <app> --set publicNetworkAccess=Disabled
```

## Message handling

Messages are received in `peekLock` mode with `autoCompleteMessages: false`, and
settled explicitly:

- handled → `completeMessage`
- handler threw → `abandonMessage`, so Service Bus redelivers and eventually
  dead-letters after `maxDeliveryCount` attempts
- body is not a JSON event → `deadLetterMessage` with reason `InvalidPayload`
  (retrying would not help)

Bodies are accepted as an object, a JSON string, or bytes, which covers how
Event Grid and other producers write to the queue.

## Operational notes for App Service

- Turn on **Always On**, or the worker is unloaded when idle and stops
  consuming.
- Every scaled-out instance runs its own receiver. That is what you want for a
  queue (competing consumers); for a topic subscription use sessions or a single
  instance if ordering matters.
- `onModuleDestroy` closes the receiver and client, so a restart or slot swap
  drains cleanly.

## Verifying

Send a test message and watch the log stream:

```bash
az servicebus queue send -g <rg> --namespace-name <ns> --name hello-events \
  --body '{"id":"1","eventType":"Bnm.Hello","subject":"/hello"}'

az webapp log tail -g <rg> -n <app> | grep HelloEvent
# [HelloEventService] Hello, world from Bnm.Hello (id: 1, subject: /hello)
```

---

# Option B — HTTP webhook, internal only

For producers that can only push over HTTP. Answers only callers that reach the
App Service from inside Azure.

- Routes: `/api/internal/events/hello` (`POST`, `GET`, `OPTIONS`)
- Guard: `src/common/guards/azure-internal.guard.ts`
- Config: `src/config/internal-events.config.ts`

## How "internal only" is enforced

Three layers, each of which is on its own enough to keep a public caller out.

### 1. Azure network controls (configure this — the app cannot do it for you)

The app runs behind the App Service front end, so the platform must be told not
to accept public traffic for it. Pick one:

**Private endpoint (strongest).** The app gets a private IP in your VNet and the
public hostname stops serving traffic entirely:

```bash
az webapp update \
  --resource-group <rg> --name <app> \
  --set publicNetworkAccess=Disabled

az network private-endpoint create \
  --resource-group <rg> --name <app>-pe \
  --vnet-name <vnet> --subnet <subnet> \
  --private-connection-resource-id $(az webapp show -g <rg> -n <app> --query id -o tsv) \
  --group-id sites --connection-name <app>-pe-conn
```

**Access restrictions with service tags** (when the app must stay public for
other routes). Deny everything, then allow only the Azure services that deliver
events, and scope the rule to the internal path:

```bash
# Allow Event Grid, on the internal path only.
az webapp config access-restriction add \
  --resource-group <rg> --name <app> \
  --rule-name allow-event-grid --action Allow --priority 100 \
  --service-tag AzureEventGrid --http-header x-internal-event-key=<key>

# Everything else is denied.
az webapp config access-restriction add \
  --resource-group <rg> --name <app> \
  --rule-name deny-all --action Deny --priority 2147483647 --ip-address 0.0.0.0/0
```

Traffic from a VNet-integrated caller or a private endpoint arrives with a
private source address; public traffic does not. That difference is what layer 2
keys off.

### 2. `AzureInternalGuard` (in the app)

Every route on the controller is behind the guard, which requires **both**:

- **An internal network origin.** The socket peer and *every* `X-Forwarded-For`
  hop must fall inside a private or Azure-internal range: loopback, RFC 1918 /
  RFC 4193, the wire server `168.63.129.16`, link-local `169.254.0.0/16`, plus
  anything listed in `INTERNAL_EVENTS_ALLOWED_CIDRS`. App Service records the
  real caller IP in `X-Forwarded-For`, so a request that came through the public
  front end carries a public address and is rejected with `403`.
- **The internal key.** `x-internal-event-key` must match `INTERNAL_EVENTS_KEY`
  (compared with `timingSafeEqual`); otherwise `401`. This covers a compromised
  or misconfigured neighbour inside the same VNet.

The guard fails closed: with the listener disabled or no key configured it
answers `503` and never runs the handler. The network check runs before the key
check, so a public caller cannot probe the key at all.

### 3. Not part of the public surface

- `@ApiExcludeController()` keeps the routes out of Swagger.
- CORS is disabled for everything under `/api/internal` (`src/main.ts`), so a
  browser cannot read the responses cross-origin.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `INTERNAL_EVENTS_ENABLED` | no | `false` | Turns the listener on. While `false` every route answers `503`. |
| `INTERNAL_EVENTS_KEY` | when enabled | – | Shared secret (min 32 chars) expected in `x-internal-event-key`. |
| `INTERNAL_EVENTS_ALLOWED_CIDRS` | no | – | Extra CIDRs allowed on top of the built-in internal ranges, comma separated. |
| `INTERNAL_EVENTS_ALLOWED_ORIGIN` | no | `eventgrid.azure.net` | Origin echoed in the CloudEvents `WebHook-Allowed-Origin` handshake. |

Store `INTERNAL_EVENTS_KEY` in Key Vault and reference it from App Settings:

```bash
az webapp config appsettings set -g <rg> -n <app> --settings \
  INTERNAL_EVENTS_ENABLED=true \
  INTERNAL_EVENTS_KEY='@Microsoft.KeyVault(SecretUri=https://<vault>.vault.azure.net/secrets/internal-events-key/)'
```

> **`APP_ENV` note.** `MainEnvBlockGuard` is registered globally and blocks
> *all* routes when `APP_ENV` is unset or `main`, this listener included. That
> existing policy is left untouched: run the listener on a slot where
> `APP_ENV=dev` or `APP_ENV=stage`, or exempt the internal routes from that
> guard deliberately if you want it live in `main`.

## Wiring up Event Grid

```bash
az eventgrid event-subscription create \
  --name hello-internal \
  --source-resource-id <topic-or-source-id> \
  --endpoint https://<app>.azurewebsites.net/api/internal/events/hello \
  --endpoint-type webhook \
  --delivery-attribute-mapping x-internal-event-key static <key> --secret
```

The listener answers both handshakes:

- **Event Grid schema** — a `Microsoft.EventGrid.SubscriptionValidationEvent`
  POST is answered with `{ "validationResponse": "<code>" }`.
- **CloudEvents v1.0** — the `OPTIONS` abuse-protection request is answered with
  `WebHook-Allowed-Origin` and `WebHook-Allowed-Rate`.

Both handshake requests pass through the guard like any other request, so the
subscription must be created with the delivery attribute above and must reach
the app over a private path. If Event Grid cannot deliver the key on the
`OPTIONS` request for your subscription, use the Event Grid schema (validated
over `POST`, which does carry delivery attributes) instead of CloudEvents.

## Verifying

From inside the network (SSH into the App Service instance, or any
VNet-integrated host):

```bash
curl -i -X POST http://localhost:3000/api/internal/events/hello \
  -H 'content-type: application/json' \
  -H "x-internal-event-key: $INTERNAL_EVENTS_KEY" \
  -d '[{"id":"1","eventType":"Bnm.Hello","subject":"/hello","data":{}}]'
# 200 {"message":"Hello, world","receivedCount":1,...}
```

From the public internet the same call returns `403` (public source address) —
and, with a private endpoint or access restrictions in place, never reaches the
app at all.

Payloads are logged by `HelloEventService`, so deliveries show up in App Service
log stream / Application Insights.

---

# Tests

```bash
npm test -- internal-events azure-internal ip.util
```

Covers the CIDR matching, the guard's allow/deny decisions (including the
forwarded-chain case), the hello-world handling of both event schemas, the
routes end to end via supertest, and the pull-based listener's receive/settle
behaviour against a mocked Service Bus SDK.
