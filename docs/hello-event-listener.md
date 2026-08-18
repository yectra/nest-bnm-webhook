# "Hello world" event listener

An event listener that is **not reachable from the public internet**, because it
has no endpoint at all.

`HelloEventListener` is a plain `@Injectable()` provider implementing
`OnModuleInit` / `OnModuleDestroy`. Nothing maps it to a route — the module
registers no controller — so the app exposes no HTTP surface for it. Instead of
waiting to be called, it opens an **outbound** connection to Azure Service Bus
and pulls events from a queue (or topic subscription). Event Grid, or any other
Azure-internal producer, delivers into that queue.

That is the strongest form of "internal only": there is no inbound port to
restrict, no key on a request path to rotate or leak, and the app can run with
`publicNetworkAccess=Disabled`.

Files:

- `src/modules/internal-events/services/hello-event.listener.ts` — the listener
- `src/modules/internal-events/services/hello-event.service.ts` — the handler
- `src/modules/internal-events/internal-events.module.ts` — providers only, no controller
- `src/config/event-listener.config.ts` — configuration

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

With no public ingress needed for the listener, the app itself can be closed off
entirely:

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
Event Grid and other producers write to the queue. Both the Event Grid schema
(`eventType`) and CloudEvents v1.0 (`type`) are understood.

## Operational notes for App Service

- Turn on **Always On**, or the worker is unloaded when idle and stops
  consuming.
- Every scaled-out instance runs its own receiver. That is what you want for a
  queue (competing consumers); for a topic subscription use sessions or a single
  instance if ordering matters.
- `onModuleDestroy` closes the subscription, receiver and client, so a restart or
  slot swap drains cleanly.
- The global `MainEnvBlockGuard` only blocks HTTP routes, so it does not affect
  this listener.

## Verifying

Send a test message and watch the log stream:

```bash
az servicebus queue send -g <rg> --namespace-name <ns> --name hello-events \
  --body '{"id":"1","eventType":"Bnm.Hello","subject":"/hello"}'

az webapp log tail -g <rg> -n <app> | grep HelloEvent
# [HelloEventService] Hello, world from Bnm.Hello (id: 1, subject: /hello)
```

## Tests

```bash
npm test -- internal-events
```

Covers the hello-world handling of both event schemas, and the listener's
connect, receive and settle behaviour (queue and topic sources, managed identity,
complete / abandon / dead-letter, idle-when-misconfigured, clean shutdown)
against a mocked Service Bus SDK.
