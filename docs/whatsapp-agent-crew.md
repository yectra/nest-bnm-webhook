# WhatsApp Agent Crew (Twilio → Azure Event Grid → LangGraph)

Asynchronous processing pipeline for inbound Twilio WhatsApp messages.

## Flow

```
Twilio WhatsApp webhook
  POST /api/webhook/whatsapp            (signature-validated, all message types parsed)
        |
        |  publishes Bnm.Whatsapp.MessageReceived to Azure Event Grid
        |  (or the in-process fallback bus when the topic is not configured)
        |  and immediately returns a TwiML acknowledgement
        v
Azure Event Grid push subscription
  POST /api/webhook/whatsapp/events     (handles the subscription-validation handshake,
        |                                acks deliveries instantly, processes in background)
        v
WhatsApp LangGraph crew
  START -> intake -> adversaryFilter -> supervisor -+-> projectAgent      -+
                          |                         +-> quoteAgent         +-> attributionAgent
                          | (adversarial: safe      +-> requirementsAgent  +        |
                          |  canned reply)          +-> feedbackAgent     -+        v
                          +----------------------> piiFilter <------------- synthesize
                                                       |
                                      END <- dispatchAgent
        |
        v
Reply sent to the customer over the Twilio REST API (whatsapp:<number>)
```

## Nodes

| Node | Responsibility |
| --- | --- |
| `intake` | Normalizes **every** message type into text the crew can reason over: text, image (GPT vision description), video, audio/voice, document, sticker, location, contact cards, button replies, interactive list replies, reactions. |
| `adversaryFilter` | Prompt-injection guard. A deterministic regex pass catches known attacks ("ignore previous instructions", "do not consider agent responses", "reveal your system prompt", role overrides, jailbreaks, guard-bypass requests); an optional LLM review catches paraphrased ones (fails open so real customers are never locked out). Flagged messages never reach the planner, retrieval, or synthesis LLMs — they jump straight to the PII filter with a safe canned reply. All crew prompts additionally instruct the models to treat customer text as data, not instructions. |
| `supervisor` | LLM planner (keyword-heuristic fallback) that decides which retrieval agents run; derived from the agent registry. |
| `projectAgent` | Customer's **project details** (`Project` container): vector matches + most recent records. |
| `quoteAgent` | Customer's **quote details** (`Quote` container). |
| `requirementsAgent` | Customer's **Post Your Requirements** submissions (`PostYourRequirements` container). |
| `feedbackAgent` | Customer's **feedback form responses** (`Feedback` container). |
| `attributionAgent` | Decides the **response attribution**: which journey (project / quote / requirements / feedback / general) and which specific record the customer's message belongs to, with confidence + rationale. Hallucinated record ids are rejected; falls back to a best-similarity heuristic. |
| `synthesize` | Writes the WhatsApp-style reply grounded only in retrieved context and the attribution decision. |
| `piiFilter` | Deterministic regex pass + optional LLM review (shared with the existing agent crew) — no reply can skip it. |
| `dispatchAgent` | Sends the final reply back to the customer via Twilio. |

Selected retrieval agents run in parallel inside one LangGraph superstep and fan
back in at the attribution node. Adding a crew member = implement
`WhatsappCrewAgentDefinition` and append it to the registry in
`whatsapp-crew.module.ts` — the graph, supervisor prompt, routing, and
attribution candidates all derive from the registry.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `WHATSAPP_CREW_ENABLED` | `true` | Kill-switch for crew processing. |
| `WHATSAPP_CREW_ADVERSARY_LLM_REVIEW` | `true` | Extra LLM pass in the adversary filter for paraphrased injection attempts (the regex pass always runs). |
| `AZURE_EVENT_GRID_TOPIC_ENDPOINT` | — | Custom-topic endpoint. Unset → in-process fallback bus. |
| `AZURE_EVENT_GRID_TOPIC_KEY` | — | Topic access key (`aeg-sas-key`). |
| `AZURE_EVENT_GRID_WEBHOOK_SECRET` | — | When set, required as `?code=` on the events endpoint. |
| `WHATSAPP_CREW_PROJECT_CONTAINER` | `Project` | Project details container. |
| `AGENT_CREW_QUOTE_CONTAINER` | `Quote` | Quote details container (shared). |
| `AGENT_CREW_REQUIREMENTS_CONTAINER` | `PostYourRequirements` | Requirements container (shared). |
| `WHATSAPP_CREW_FEEDBACK_CONTAINER` | `Feedback` | Feedback form responses container. |
| `OPENAI_IMAGE_MODEL` | `gpt-5-nano` | Vision model for inbound pictures. |

### Azure setup

1. Create an Event Grid custom topic; put its endpoint/key in the two
   `AZURE_EVENT_GRID_TOPIC_*` variables.
2. Create an event subscription on the topic with a **webhook** destination
   pointing at `https://<host>/api/webhook/whatsapp/events?code=<secret>` and
   (optionally) an event-type filter for `Bnm.Whatsapp.MessageReceived`.
   The endpoint answers the subscription-validation handshake automatically.

Conversations are persisted per customer as `whatsapp:<WaId>` on the
`WhatsApp` channel, so replies keep conversational context across messages.
