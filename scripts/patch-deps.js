const fs = require('fs');
const path = require('path');

// 1. Remove nested ESM p-retry / p-queue inside @langchain/langgraph-sdk if present
const nestedPClient = path.join(
  __dirname,
  '..',
  'node_modules',
  '@langchain',
  'langgraph-sdk',
  'node_modules',
  'p-retry',
);
if (fs.existsSync(nestedPClient)) {
  try {
    fs.rmSync(nestedPClient, { recursive: true, force: true });
    console.log('[patch-deps] Removed nested ESM p-retry in langgraph-sdk');
  } catch (e) {}
}

const nestedPQueue = path.join(
  __dirname,
  '..',
  'node_modules',
  '@langchain',
  'langgraph-sdk',
  'node_modules',
  'p-queue',
);
if (fs.existsSync(nestedPQueue)) {
  try {
    fs.rmSync(nestedPQueue, { recursive: true, force: true });
    console.log('[patch-deps] Removed nested ESM p-queue in langgraph-sdk');
  } catch (e) {}
}

// 2. Patch async_caller.cjs and async_caller.js to use root CJS dependencies
['async_caller.cjs', 'async_caller.js'].forEach((filename) => {
  const filePath = path.join(
    __dirname,
    '..',
    'node_modules',
    '@langchain',
    'langgraph-sdk',
    'dist',
    'utils',
    filename,
  );

  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');

    content = content.replace(
      /\.\.\/node_modules\/\.pnpm\/p-retry@[^/]+\/node_modules\/p-retry\/index\.(c?js)/g,
      'p-retry',
    );
    content = content.replace(
      /\.\.\/node_modules\/\.pnpm\/p-queue@[^/]+\/node_modules\/p-queue\/dist\/index\.(c?js)/g,
      'p-queue',
    );

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[patch-deps] Successfully patched ${filename}`);
  }
});
