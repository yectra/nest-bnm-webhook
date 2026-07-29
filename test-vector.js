const { CosmosClient } = require('@azure/cosmos');
const { OpenAI } = require('openai');
require('dotenv').config();

const client = new CosmosClient({ endpoint: process.env.COSMOS_ENDPOINT, key: process.env.COSMOS_KEY });
const database = client.database(process.env.COSMOS_DATABASE);
const openai = new OpenAI({ baseURL: process.env.OPENAI_BASE_URL, apiKey: process.env.OPENAI_API_KEY });

async function test() {
  const container = database.container('Service');
  try {
    const text = 'Tell me about Interior Designers';
    const embedResponse = await openai.embeddings.create({
      model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
      input: [text],
      dimensions: 1536
    });
    const queryEmbedding = embedResponse.data[0].embedding;
    console.log('Embedding generated for:', text);

    const testFilter = "NOT STARTSWITH(c.id, 'MovinService:')";
    const query = `SELECT TOP 5 VectorDistance(c.embedding, @embedding) AS distance, c.id, c.category.name as categoryName, c.seoLocation FROM c WHERE IS_DEFINED(c.embedding) AND ${testFilter} ORDER BY VectorDistance(c.embedding, @embedding)`;
    
    console.log('Executing query...');
    const { resources } = await container.items.query({
      query,
      parameters: [{ name: '@embedding', value: queryEmbedding }]
    }).fetchAll();
    
    console.log('Query returned', resources.length, 'matches.');
    if (resources.length > 0) {
      resources.forEach(r => {
        console.log(`ID: ${r.id}, Distance: ${r.distance}, Similarity: ${1 - r.distance}, Category: ${r.categoryName}`);
      });
    }
  } catch (err) {
    console.error('Error:', err);
  }
}
test();
