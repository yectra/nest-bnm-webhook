import * as fs from 'fs';
import * as path from 'path';
import { CosmosClient } from '@azure/cosmos';
import {
  ActiveBudgetDocument,
  ResetAuditEntry,
} from '../src/modules/token-budget/token-budget.types';
import {
  GLOBAL_PK,
  ACTIVE_BUDGET_DOC_ID,
} from '../src/modules/token-budget/token-budget.repository';

// Helper to load .env file if present
function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

async function main(): Promise<void> {
  const rootDir = path.resolve(__dirname, '..');
  loadEnvFile(path.join(rootDir, '.env'));

  const args = process.argv.slice(2);
  const isConfirm = args.includes('--confirm');
  const isForce = args.includes('--force');
  const isStatusOnly = args.includes('--status');
  const isHelp = args.includes('--help') || args.includes('-h');

  if (isHelp) {
    console.log(`
Usage: npm run ai-budget:reset -- [options]

Options:
  --confirm    Explicitly confirm the reset operation (required for reset).
  --force      Force reset even if unexpired active reservations exist.
  --status     Only check and display the current budget state without resetting.
  --help, -h   Show this help message.

Environment Requirements:
  AI_TOKEN_BUDGET_MANUAL_RESET_ENABLED=true  (Must be set in local .env)
  NODE_ENV != 'production'                   (Reset is strictly blocked in production)
`);
    process.exit(0);
  }

  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  const databaseId = process.env.COSMOS_DATABASE;
  const containerId =
    process.env.AI_TOKEN_BUDGET_CONTAINER_NAME || 'ai-token-budget';
  const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
  const resetEnabled =
    process.env.AI_TOKEN_BUDGET_MANUAL_RESET_ENABLED === 'true';

  console.log('----------------------------------------------------');
  console.log('AI TOKEN BUDGET CLI TOOL (Azure Cosmos DB)');
  console.log('----------------------------------------------------');
  console.log(`Node Environment:     ${nodeEnv}`);
  console.log(`Manual Reset Enabled: ${resetEnabled}`);
  console.log(`Database:             ${databaseId || 'not configured'}`);
  console.log(`Container:            ${containerId}`);
  console.log('----------------------------------------------------');

  if (!endpoint || !key || !databaseId) {
    console.error(
      'ERROR: Missing Cosmos DB configuration (COSMOS_ENDPOINT, COSMOS_KEY, or COSMOS_DATABASE).',
    );
    process.exit(1);
  }

  const client = new CosmosClient({ endpoint, key });
  const database = client.database(databaseId);
  const container = database.container(containerId);

  // 1. Read existing active budget
  let activeBudget: ActiveBudgetDocument | undefined;
  let etag: string | undefined;

  try {
    const response = await container
      .item(ACTIVE_BUDGET_DOC_ID, GLOBAL_PK)
      .read<ActiveBudgetDocument>();
    activeBudget = response.resource;
    etag = response.etag;
  } catch (err: unknown) {
    const error = err as {
      statusCode?: number;
      code?: number;
      message?: string;
    };
    if (error.statusCode !== 404 && error.code !== 404) {
      console.error(
        `ERROR: Failed to read from Cosmos DB container "${containerId}": ${
          error.message || String(err)
        }`,
      );
      process.exit(1);
    }
  }

  if (!activeBudget) {
    console.log('No existing active budget document found in Cosmos DB.');
    if (isStatusOnly) {
      console.log(
        'Status: Uninitialized (budget document will be created automatically on first model call).',
      );
      process.exit(0);
    }
  }

  const parsedLimit = Number(
    activeBudget?.budgetLimit ?? process.env.AI_TOKEN_BUDGET_LIMIT,
  );
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10000;

  const parsedWindow = Number(
    activeBudget?.windowHours ?? process.env.AI_TOKEN_BUDGET_WINDOW_HOURS,
  );
  const windowHours =
    Number.isFinite(parsedWindow) && parsedWindow > 0 ? parsedWindow : 24;
  const generation = activeBudget?.generation ?? 1;

  // Calculate current rolling window usage
  const now = Date.now();
  const windowStartMs = now - windowHours * 3600 * 1000;
  let currentUsage = 0;
  if (activeBudget?.buckets) {
    for (const [bucketKey, tokens] of Object.entries(activeBudget.buckets)) {
      if (Number(bucketKey) + 15 * 60 * 1000 >= windowStartMs) {
        currentUsage += Number(tokens);
      }
    }
  }

  // Calculate active reservations
  let activeReservationsCount = 0;
  let activeReservedTokens = 0;
  if (activeBudget?.reservations) {
    for (const res of Object.values(activeBudget.reservations)) {
      if (res && res.expiresAt && res.expiresAt >= now) {
        activeReservationsCount++;
        activeReservedTokens += Number(res.reservedTokens);
      }
    }
  }

  console.log(`Current Generation:     ${generation}`);
  console.log(`Configured Limit:       ${limit} tokens`);
  console.log(`Window Hours:           ${windowHours} hours`);
  console.log(`Current 24h Usage:      ${currentUsage} tokens`);
  console.log(
    `Active Reservations:    ${activeReservationsCount} (${activeReservedTokens} tokens)`,
  );
  console.log(
    `Remaining Budget:       ${Math.max(
      0,
      limit - (currentUsage + activeReservedTokens),
    )} tokens`,
  );
  console.log('----------------------------------------------------');

  if (isStatusOnly) {
    console.log('Status inspection completed.');
    process.exit(0);
  }

  // Safety validations for RESET
  if (nodeEnv === 'production') {
    console.error(
      'SAFETY BLOCK: Manual reset is strictly prohibited in production environments (NODE_ENV=production).',
    );
    process.exit(1);
  }

  if (!resetEnabled) {
    console.error(
      'SAFETY BLOCK: Manual reset is disabled. Set AI_TOKEN_BUDGET_MANUAL_RESET_ENABLED=true in your .env file to enable.',
    );
    process.exit(1);
  }

  if (!isConfirm) {
    console.error(
      'CONFIRMATION REQUIRED: Please pass --confirm to execute the reset.',
    );
    console.log('Example: npm run ai-budget:reset -- --confirm');
    process.exit(1);
  }

  if (activeReservationsCount > 0 && !isForce) {
    console.error(
      `ABORTED: There are ${activeReservationsCount} active, unexpired reservations (${activeReservedTokens} tokens).`,
    );
    console.error(
      'Resetting now could corrupt in-flight accounting. Wait for them to complete or pass --force to override.',
    );
    process.exit(1);
  }

  // Perform atomic reset
  console.log('Resetting token budget in Cosmos DB...');

  const prevGen = generation;
  const newGen = prevGen + 1;
  const auditRecordId = `reset_${now}`;

  const updatedDoc: ActiveBudgetDocument = {
    id: ACTIVE_BUDGET_DOC_ID,
    pk: GLOBAL_PK,
    budgetLimit: limit,
    windowHours,
    generation: newGen,
    buckets: {},
    reservations: {},
    processedEvents: {},
    updatedAt: new Date(now).toISOString(),
  };

  try {
    if (activeBudget && etag) {
      await container
        .item(ACTIVE_BUDGET_DOC_ID, GLOBAL_PK)
        .replace(updatedDoc, {
          accessCondition: { type: 'IfMatch', condition: etag },
        });
    } else {
      await container.items.create(updatedDoc);
    }

    // Write audit record
    const auditEntry: ResetAuditEntry = {
      id: auditRecordId,
      pk: GLOBAL_PK,
      type: 'RESET_EVENT',
      previousGeneration: prevGen,
      newGeneration: newGen,
      previousUsage: currentUsage,
      clearedReservationsCount: activeReservationsCount,
      timestamp: new Date(now).toISOString(),
      triggeredBy: 'cli-manual-reset',
    };

    await container.items.create(auditEntry);

    console.log('====================================================');
    console.log('AI TOKEN BUDGET RESET SUCCESSFUL');
    console.log('====================================================');
    console.log(`Previous Generation:  ${prevGen}`);
    console.log(`New Generation:       ${newGen}`);
    console.log(`Previous 24h Usage:   ${currentUsage} tokens`);
    console.log(`Cleared Reservations: ${activeReservationsCount}`);
    console.log(`Reset Timestamp:      ${new Date(now).toISOString()}`);
    console.log(`Audit Record ID:      ${auditRecordId}`);
    console.log('====================================================');
    console.log(
      `Budget is now active with 0 tokens used in generation ${newGen}.`,
    );
    process.exit(0);
  } catch (err: unknown) {
    const error = err as { message?: string };
    console.error(
      `ERROR: Failed to reset budget in Cosmos DB: ${
        error.message || String(err)
      }`,
    );
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const error = err as { message?: string };
  console.error(`Fatal error: ${error.message || String(err)}`);
  process.exit(1);
});
