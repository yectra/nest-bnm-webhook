# Epic B — Work IQ for SharePoint documents (work data)

**Status:** Proposal (B0)
**Scope:** Ground Microsoft "IQ" over BNM **documents** held in SharePoint / M365.
**Author:** Platform / Backend
**Related epic:** [Epic A — Cosmos Vector Search + Fabric IQ](./epic-a-cosmos-vector-fabric-iq.md)

---

## 1. Goal

Let BNM documents that live in **SharePoint** (proposals, spec sheets, contracts,
brand guidelines, catalogs) be reasoned over by Microsoft's **Work IQ**, and then
combined with the Epic A business-data ontology in a single **Foundry IQ
knowledge base** so **one agent answers both** document questions ("what does our
standard vendor contract say about warranty?") and business-data questions ("which
vendors have open quotes in Chennai?").

## 2. Work IQ vs Fabric IQ — two distinct planes

| | **Work IQ** | **Fabric IQ** (Epic A) |
|---|-------------|------------------------|
| Grounds over | M365 **work data** — SharePoint docs, mail, Teams chats | **Business data** in OneLake (mirrored from Cosmos) |
| Reached via | Microsoft **Graph** | Fabric REST (GraphQL / GQL) |
| Permission model | Honors per-user M365 / SharePoint ACLs | Fabric workspace / item permissions |

Both can ground the **same** assistant. This epic wires the SharePoint/Graph side
and contributes it as a **document knowledge source** in the shared knowledge base.

## 3. Locked architectural decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **SharePoint docs reached via Microsoft Graph.** | Standard, permission-aware access to sites/drives/files; same Entra tenant. |
| 2 | **Docs added as a document knowledge source** alongside the Epic A ontology in **one Foundry IQ knowledge base**. | A single agent answers across documents *and* business data. |
| 3 | **App calls the agent via its REST endpoint.** | The agent does the retrieval/grounding; the app orchestrates and passes user context. |
| 4 | **Auth = Entra** service principal / managed identity; secrets in vault/env via `@azure/identity`. | Mirrors the existing config pattern; never commit secrets. |

## 4. SharePoint sites, libraries & permissions

- **Sites / libraries:** the BNM document estate is a set of SharePoint sites and
  document libraries (drives). The Graph client resolves these by
  `siteId`/`driveId` (configured) and reads files via
  `/sites/{siteId}/drives/{driveId}/root/children` and Graph **search**
  (`/search/query`) over `driveItem`.
- **Permissions:** two modes, chosen per surface:
  - **Application permissions** (`Sites.Read.All` / `Files.Read.All`) — the
    service principal reads on behalf of the app. Used for building/refreshing the
    knowledge base. Broad; guard the surface.
  - **Delegated permissions** (on-behalf-of the signed-in user) — preserves
    per-user SharePoint ACLs when a user-facing query must only see what that user
    can see. Preferred for user-facing document retrieval (B2 controller route).
- The Entra **app registration** grants these; the client secret / certificate is
  resolved through `@azure/identity`, never committed.

## 5. Delivery plan (PR-by-PR)

| PR | Type | What |
|----|------|------|
| **B0** | docs | This proposal. No code. |
| **B1** | feat | Microsoft Graph client provider + config (Entra app reg, vault secret) in a shared `GraphModule`. |
| **B2** | feat | `SharePointDocService` — search/retrieve docs via Graph; a controller route if user-facing. |
| **B3** | feat | `FoundryIqAgentService` — call the Foundry agent REST endpoint grounded on the knowledge base (SharePoint docs + Epic A ontology). **Depends on B2 and Epic A / A5.** |

**Merge order:** B0 → B1 → B2. **B3 waits on A5** (it grounds on both the
SharePoint docs *and* the Fabric ontology, so it needs the Fabric query service
from Epic A in place).

## 6. B1 — Graph client provider (this PR)

Delivered here so B2/B3 can inject it:

- **Config** (`microsoft-graph.config.ts`, `registerAs('microsoftGraph')`):
  `tenantId`, `clientId`, `clientSecret`, Graph `baseUrl`
  (`https://graph.microsoft.com/v1.0`), and `scope`
  (`https://graph.microsoft.com/.default`). All optional in the Joi schema so the
  app still boots without them until Graph is wired.
- **`GraphClientService`** (`@Injectable()`): builds a `TokenCredential` —
  `ClientSecretCredential` when a client id/secret/tenant are configured
  (app registration), otherwise `DefaultAzureCredential` (managed identity) —
  acquires and caches a bearer token for the Graph scope, and exposes a
  pre-configured Axios client (`getHttpClient()`) that injects the token per
  request.
- **`GraphModule`**: provides and exports `GraphClientService`.

No SharePoint-specific logic lives in B1 — that is B2.

## 7. Validation gate (A4 + B2 checkpoint)

Once Cosmos is mirrored (Epic A / A4) and SharePoint docs are reachable (B2),
stand up the unified **Foundry IQ knowledge base** in the portal (ontology +
documents) and validate end-to-end value (Power BI dashboards + a combined agent)
**before** committing to the app-layer PRs A5 and B3. Treat A4 + B2 as a
demo/decision checkpoint.

## 8. Out of scope

- The Foundry IQ knowledge base itself (configured in the portal, not repo code).
- Ingesting/duplicating document content into Cosmos — Graph serves docs in place.
- Fabric business-data querying (Epic A).
