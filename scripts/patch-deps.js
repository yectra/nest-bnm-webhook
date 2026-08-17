const fs = require('fs');
const path = require('path');

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
