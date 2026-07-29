const { CosmosClient } = require('@azure/cosmos');
const { OpenAI } = require('openai');
require('dotenv').config();
const client = new CosmosClient({ endpoint: process.env.COSMOS_ENDPOINT, key: process.env.COSMOS_KEY });
const openai = new OpenAI({ baseURL: process.env.OPENAI_BASE_URL, apiKey: process.env.OPENAI_API_KEY });
async function test() {
  try {
    const embedResponse = await openai.embeddings.create({ model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small', input: ['design'], dimensions: 1536 });
    const queryEmbedding = embedResponse.data[0].embedding;
    const testFilter = "NOT STARTSWITH(c.id, 'MovinService:')";
    const query = `SELECT TOP 5 VectorDistance(c.embedding, @embedding) AS distance, c AS document FROM c WHERE IS_DEFINED(c.embedding) AND 1=1 AND ${testFilter} ORDER BY VectorDistance(c.embedding, @embedding)`;
    const container = client.database(process.env.COSMOS_DATABASE).container('EmbeddedDocuments');
    console.log('Running query on EmbeddedDocuments...');
    const start = Date.now();
    const { resources } = await container.items.query({ query, parameters: [{ name: '@embedding', value: queryEmbedding }] }).fetchAll();
    console.log('Finished Vector Query in', Date.now() - start, 'ms. Found:', resources.length);
  } catch (err) { console.error('Error:', err.message); }
}
test();
