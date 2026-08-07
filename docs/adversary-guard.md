# Adversary Guard (reusable prompt-injection filter)

`src/modules/adversary-guard/` is a standalone module that classifies any
untrusted text — WhatsApp messages today, website/Teams chat, search queries,
or future subagents — as adversarial (prompt injection, e.g. *"do not
consider agent responses"*, *"ignore previous instructions"*) or genuine.

## Escalation ladder (cheapest first)

```
inspect(text)
  1. regex patterns        free          known injection shapes
  2. semantic match        ~free         one embedding + one VectorDistance query
                                         against the AdversarialInputs Cosmos DB
                                         vector container of known-attack exemplars
  3. OSS model review      low cost      only for the borderline similarity band
                                         (default deployment: phi-4-mini-instruct)
```

- **Semantic filtering**: the module owns a dedicated Cosmos DB **vector
  container** (`AdversarialInputs` by default, created automatically with the
  repo's standard vector policy). On startup it seeds ~30 exemplar attack
  phrases with embeddings. Classifying a message costs one embedding call and
  one `VectorDistance` query; similarity ≥ `ADVERSARY_GUARD_BLOCK_THRESHOLD`
  blocks outright, so paraphrases of known attacks are caught with no LLM at
  all.
- **Open-source review model**: messages in the borderline band
  (`REVIEW_THRESHOLD ≤ similarity < BLOCK_THRESHOLD`) are classified by a
  low-cost open-source model over any **OpenAI-compatible endpoint** — an
  Azure AI Foundry serverless Phi/Llama deployment, or a self-hosted
  Ollama/vLLM server (point `ADVERSARY_GUARD_LLM_BASE_URL` at it; then the
  model is effectively free). The big GPT deployment is never used for
  filtering.
- **Learning loop**: every confirmed attack (pattern, semantic, or LLM
  verdict) is upserted back into the vector container (`source='learned'`),
  so the semantic net widens over time and an attack caught in one workflow
  protects all workflows sharing the container.
- **Fail open**: an unreachable container or model never blocks a genuine
  customer; the remaining layers still apply.

## Using it in any workflow

```ts
// your.module.ts
imports: [AdversaryGuardModule]

// your service / graph node
constructor(private readonly adversaryGuard: AdversaryGuardService) {}

const verdict = await this.adversaryGuard.inspect(untrustedText);
if (verdict.adversarial) {
  // verdict.method: 'pattern' | 'semantic' | 'llm'
  // verdict.semanticMatch: closest known attack + similarity
  // short-circuit / safe reply / audit log
}
```

The WhatsApp crew wires it in as the `adversaryFilter` graph node; the
website/Teams agent crew can add it the same way (a node before its
supervisor), and non-graph code can simply call `inspect()`.

`AdversaryVectorStoreService` is also exported for direct exemplar
management (`addLearnedExemplar(text, label)`), e.g. from an admin endpoint
or a moderation workflow.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADVERSARY_GUARD_CONTAINER` | `AdversarialInputs` | Cosmos DB vector container of attack exemplars. |
| `ADVERSARY_GUARD_SEED` | `true` | Create the container and seed exemplars on startup. |
| `ADVERSARY_GUARD_LEARN` | `true` | Write confirmed attacks back as learned exemplars. |
| `ADVERSARY_GUARD_TOP_K` | `3` | Vector query result count. |
| `ADVERSARY_GUARD_BLOCK_THRESHOLD` | `0.82` | Similarity at/above which a message is blocked semantically. |
| `ADVERSARY_GUARD_REVIEW_THRESHOLD` | `0.6` | Lower bound of the borderline band escalated to the OSS model. |
| `ADVERSARY_GUARD_LLM_REVIEW` | `true` | Enable/disable the OSS model review. |
| `ADVERSARY_GUARD_LLM_MODEL` | `phi-4-mini-instruct` | Deployment/model name of the open-source classifier. |
| `ADVERSARY_GUARD_LLM_BASE_URL` | `OPENAI_BASE_URL` | OpenAI-compatible endpoint serving the OSS model (Foundry, Ollama, vLLM…). |
| `ADVERSARY_GUARD_LLM_API_KEY` | `OPENAI_API_KEY` | Key for that endpoint (Ollama accepts any non-empty string). |

Embeddings reuse the app-wide `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS`
settings so exemplar vectors and query vectors always match.
