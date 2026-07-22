# Epic A — Cosmos Vector Search + Fabric IQ (business data)

**Status:** Proposal (A0)
**Scope:** Ground Microsoft "IQ" over BNM **business data** held in Azure Cosmos DB.
**Author:** Platform / Backend
**Related epic:** [Epic B — Work IQ for SharePoint docs](./epic-b-workiq-sharepoint.md)

---

## 1. Goal

Let BNM business data (the marketplace catalog and the records users create —
services, vendors, categories, experts, projects, quotes) be reasoned over by
Microsoft's **Fabric IQ** while also being searchable semantically **live in the
request path** of this NestJS backend.

Two capabilities come out of this epic:

1. **In-app semantic search** — `POST /search/semantic` answers "find me a
   vendor who does modular kitchens in Chennai" using vector similarity, served
   directly from Cosmos DB, no external round-trip.
2. **Fabric IQ grounding** — the same Cosmos data is mirrored into Microsoft
   Fabric (OneLake), modeled as an ontology/graph, and queried by an agent so it
   can answer analytical and relationship questions over the whole business.

## 2. Locked architectural decisions

These are settled; this doc records the rationale so reviewers don't relitigate
them in later PRs.

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Vectors live IN Cosmos DB** (Cosmos vector search, DiskANN index) — not a separate vector database. | Embeddings are stored as a field on the existing entity documents and served live in the request path. No second datastore to provision, secure, sync, or pay for. |
| 2 | **Embeddings = Azure OpenAI** (`text-embedding-3-*`). | Same Entra tenant and billing as the rest of the stack; `text-embedding-3-small` → 1536 dims is the default. |
| 3 | **Cosmos → Fabric via Mirroring** (Cosmos → OneLake Delta). | Near real-time, no RU cost, no transformation, fully managed. **Do not build ETL** — ETL is only a fallback if a future need requires in-flight transformation Mirroring cannot do. |
| 4 | **Fabric IQ ontology/graph is modeled in the Fabric portal** over the mirror. | Not repo code. The ontology maps mirrored tables → entities/relationships. |
| 5 | **App queries Fabric via REST with an Entra bearer token.** | Scope `https://analysis.windows.net/powerbi/api/.default`. See §6. |
| 6 | **Auth everywhere = Entra** service principal / managed identity; secrets in vault/env. | Mirrors the existing Key Vault pattern; never commit secrets. |

## 3. Why vectors in Cosmos (not a dedicated vector DB)

- The documents being searched already live in Cosmos. Co-locating the embedding
  as a field (`embedding: number[]`) keeps the vector and its source record
  atomically consistent — no dual-write, no drift, no reconciliation job.
- Cosmos DB NoSQL supports vector indexing (**DiskANN**) and the `VectorDistance`
  system function in the query path, so similarity search is a normal Cosmos
  query with the same auth, partitioning, and RU model as everything else.
- A separate vector DB (Pinecone/Weaviate/etc.) would add a second system to
  secure under Entra, a sync pipeline, and an availability dependency — all for
  data we already store. Rejected.

## 4. Data model change (delivered in A1)

Add an optional `embedding: number[]` field to the searchable business entities.
It is **optional** so existing documents remain valid until back-filled (A2).

Entities that carry an embedding (the semantic-search surface):

| Container | Entity | Text that gets embedded (A2) |
|-----------|--------|------------------------------|
| `Service` | `ServiceEntity` | `name` + `description` + `category` |
| `Vendor` | `VendorEntity` | `companyName` + `productServiceOfferings` + `locationOfService` |
| `Category` | `CategoryEntity` | `name` + `description` |
| `AskOurExpert` | `ExpertEntity` | expert profile / specialization text |
| `Project` | `ProjectEntity` | `name` + `description` |
| `Quote` | `QuoteEntity` | `message` + `location` |

All extend a shared `Embeddable` interface so the embedding contract is defined
once.

### Cosmos vector policy (delivered in A1)

Containers that hold embeddings are provisioned with:

- **Vector embedding policy** — path `/embedding`, `dataType: float32`,
  `distanceFunction: cosine`, `dimensions: 1536` (matches `text-embedding-3-small`).
- **Vector index** — `type: diskANN` on `/embedding`, with `/embedding/*`
  excluded from the normal (range) index so it is not double-indexed.

> **Note on existing containers:** a container's vector embedding policy is set at
> creation time. Containers already provisioned without it must be **recreated**
> (create the new container with the policy, back-fill documents, swap). The A1
> `ensureVectorContainer` helper creates a correctly-configured container when one
> does not exist; migrating live containers is an operational step tracked in A4's
> runbook.

## 5. Delivery plan (PR-by-PR)

| PR | Type | What |
|----|------|------|
| **A0** | docs | This proposal. No code. |
| **A1** | feat | Cosmos vector index (DiskANN) provisioning + `embedding: number[]` on entities. |
| **A2** | feat | `EmbeddingService` + Azure OpenAI client provider; generate/store embeddings on write. |
| **A3** | feat | Vector search in the repository (`VectorDistance`), a service method, and `POST /search/semantic` with a request DTO. |
| **A4** | chore/docs | Fabric Mirroring config (Cosmos → OneLake). Infra/runbook, no app code. |
| **A5** | feat | `FabricIqService` — acquire Entra token, POST GraphQL/GQL to Fabric; wrap in `FabricIqModule`. |

**Merge order:** A0 → A1 → A2 → A3 for the in-app search path; A1 → A4 → A5 for
the Fabric path. A2/A3 and A4/A5 can proceed in parallel once A1 lands.

## 6. Fabric IQ query path (A5, documented here for context)

Once Cosmos is mirrored into OneLake (A4) and an ontology/graph is modeled in the
Fabric portal, the app queries it over REST using an **Entra bearer token** for
scope `https://analysis.windows.net/powerbi/api/.default`:

- **GraphQL API:**
  `https://api.fabric.microsoft.com/v1/workspaces/{workspaceId}/graphqlapis/{apiId}/graphql`
- **Graph model (GQL):**
  `https://api.fabric.microsoft.com/v1/workspaces/{workspaceId}/GraphModels/{modelId}/executeQuery?preview=true`

Workspace/API/model IDs come from `ConfigService`; the service-principal secret is
resolved via `@azure/identity` (`DefaultAzureCredential` / managed identity),
never committed.

## 7. Validation gate (A4 + B2 checkpoint)

Once Cosmos is mirrored (A4) and SharePoint docs are reachable (Epic B / B2),
stand up the unified **Foundry IQ knowledge base** in the Fabric portal (ontology
+ documents) and validate end-to-end value (Power BI dashboards + a combined
agent) **before** committing to the app-layer PRs A5 and B3. Treat A4 + B2 as a
demo/decision checkpoint, not an automatic go-ahead.

## 8. Out of scope

- ETL / transformation pipelines (Mirroring replaces them; ETL is fallback only).
- Modeling the ontology/graph in repo code (done in the Fabric portal).
- Any dedicated/standalone vector database.
