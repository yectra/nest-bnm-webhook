# Epic A / A4 — Fabric Mirroring runbook (Cosmos DB → OneLake)

**Status:** Infra / runbook (A4). **No application code.**
**Depends on:** A1 (vector-enabled containers exist and receive writes).
**Feeds:** A5 (`FabricIqService` queries the ontology built over this mirror) and
the A4 + B2 validation checkpoint.
**Related:** [Epic A proposal](./epic-a-cosmos-vector-fabric-iq.md)

---

## 1. What this delivers

Get BNM business data from **Azure Cosmos DB (NoSQL)** into **Microsoft Fabric /
OneLake** as near-real-time Delta tables using **Mirroring** — a fully managed,
no-code replication. This is the substrate the Fabric IQ ontology/graph is
modeled on (in the portal) and that Power BI reports read from.

**Decision (locked): use Mirroring, not ETL.** Mirroring is near real-time, costs
no Cosmos RUs for the replication, requires no transformation code, and is fully
managed. Build ETL (Data Factory / Spark) **only** if a future need requires
in-flight transformation Mirroring cannot do. This runbook does not create any
pipeline.

## 2. Prerequisites

| Item | Requirement |
|------|-------------|
| Fabric capacity | An **F**-SKU (or Trial) capacity in the target region; Mirroring enabled for the tenant. |
| Fabric workspace | A workspace on that capacity (record its **workspace id** — reused by A5). |
| Cosmos account | **Azure Cosmos DB for NoSQL**. Continuous backup / analytical enablement not required — Mirroring uses the change feed. |
| Cosmos networking | Account reachable by Fabric. If Private Endpoint / firewall is on, allow the Fabric managed-VNet / trusted Microsoft services (see §6). |
| Permissions | Fabric: **Contributor** on the workspace. Cosmos: an account **read key** or an Entra identity with data-read (see §3). |
| Identity | Prefer Entra (managed identity / service principal); fall back to account key stored in vault. Never commit secrets. |

## 3. Authentication for the mirror connection

Preferred, in order:

1. **Managed identity / service principal (Entra)** — grant the Fabric connection
   identity the Cosmos DB built-in **Data Reader** role via RBAC:

   ```bash
   # Cosmos DB NoSQL data-plane RBAC: assign Data Reader to the principal Fabric uses
   az cosmosdb sql role assignment create \
     --account-name "$COSMOS_ACCOUNT" \
     --resource-group "$COSMOS_RG" \
     --role-definition-id "00000000-0000-0000-0000-000000000001" \
     --principal-id "$FABRIC_CONNECTION_PRINCIPAL_ID" \
     --scope "/"
   ```

2. **Account key** — only if Entra auth is not available for the connection.
   Store the key in Key Vault / env (the same vault pattern the app uses); never
   commit it.

## 4. Create the mirror (Fabric portal)

1. In the Fabric workspace → **New** → **Mirrored Azure Cosmos DB** (under Data
   Warehouse / Database experiences).
2. **Connection:** create/select a connection to the Cosmos account. Provide the
   endpoint and choose the auth method from §3.
3. **Source:** select the database (e.g. the value of `COSMOS_DATABASE`) and the
   containers to mirror. Mirror the business containers that back the app:

   | Mirror | Why |
   |--------|-----|
   | `Service` | catalog analytics + ontology entity |
   | `Vendor` | catalog analytics + ontology entity |
   | `Category` | dimension / grouping |
   | `AskOurExpert` | catalog entity |
   | `Project` | business records / relationships |
   | `Quote` | business records / relationships |
   | `ContactUs` | leads/enquiries (optional) |

4. **Start** the mirror. Fabric performs an initial snapshot, then streams the
   change feed continuously into OneLake as Delta.
5. Record the created artifact's **SQL analytics endpoint** and the **workspace
   id** — used by Power BI and by A5's config.

## 5. What the mirrored data looks like

- Each container becomes a **Delta table** in the mirror's SQL analytics endpoint;
  documents map to rows, JSON fields to columns (nested JSON preserved).
- The **`embedding`** field (A1) mirrors along with the rest of the document. It
  is **not** used for Fabric-side similarity search (that stays in Cosmos, served
  live by A3) — it simply rides along; exclude it from Power BI models to avoid
  noise.
- Replication is **near real-time** and one-way (Cosmos → OneLake). Treat the
  mirror as **read-only**; all writes continue to go through the app → Cosmos.

## 6. Networking notes

- If the Cosmos account uses a firewall, enable **Allow access from Azure
  services / trusted Microsoft services**, or add the Fabric managed private
  endpoint.
- For Private Link, create a **managed private endpoint** from the Fabric
  workspace to the Cosmos account and approve it on the Cosmos side.

## 7. Validation (part of the A4 + B2 checkpoint)

- [ ] Mirror status shows **Running** with a recent "last refresh".
- [ ] Row counts per Delta table are within tolerance of the Cosmos container
      counts (allow a small replication lag).
- [ ] Write a test document to a mirrored container via the app and confirm it
      appears in the mirror within the expected lag.
- [ ] A **Power BI** report over the SQL analytics endpoint renders (e.g. quotes
      by status, services by category).
- [ ] Ontology/graph can be modeled over the mirror (done in the portal; consumed
      by A5).

> **Gate:** this validation, together with SharePoint docs reachable (B2), is the
> demo/decision checkpoint. Only after it passes do we commit to the app-layer PRs
> **A5** (`FabricIqService`) and **B3** (`FoundryIqAgentService`).

## 8. Config handed to A5 (recorded here, consumed as env/vault later)

Mirroring itself needs no app config. The **downstream** Fabric query service (A5)
will need these — capture them now while provisioning:

| Value | Notes |
|-------|-------|
| Fabric **workspace id** | GUID of the workspace hosting the mirror/ontology. |
| GraphQL API id / Graph model id | Created when the ontology/graph is published in the portal. |
| Entra app (service principal) | For token scope `https://analysis.windows.net/powerbi/api/.default`; secret in vault. |

## 9. Rollback / teardown

- Deleting the mirrored item stops replication and removes the OneLake copy;
  **Cosmos is untouched** (one-way). Safe to delete and recreate.
- No app change is required to add/remove this mirror — the app path (A1–A3) is
  independent of the Fabric path.
