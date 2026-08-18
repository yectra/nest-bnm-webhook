import { ConfigService } from '@nestjs/config';

import { CosmosService } from '../../database/cosmos.service';
import {
  PromptInjectionRagRepository,
  PROMPT_INJECTION_DOC_TYPE,
} from './prompt-injection-rag.repository';
import type { EmbeddedPromptInjectionChunk } from '../interfaces/prompt-injection.interface';

function chunk(id: string, injectionId: string): EmbeddedPromptInjectionChunk {
  return {
    id,
    injectionId,
    category: 'instruction-override',
    severity: 'high',
    title: 'Ignore previous instructions',
    recommendedAction: 'refuse-and-continue',
    corpusVersion: '2026.08.1',
    chunkIndex: 0,
    chunkCount: 1,
    content: 'content',
    embedding: [0.1, 0.2],
  };
}

describe('PromptInjectionRagRepository', () => {
  let existing: Array<{ id: string; partitionKey?: string }>;
  let deleted: Array<[string, unknown]>;
  let upserted: Array<Record<string, unknown>>;
  let querySpecs: Array<{
    query: string;
    parameters: Array<{ name: string; value: string }>;
  }>;
  let ensureVectorContainer: jest.Mock;
  let repository: PromptInjectionRagRepository;

  beforeEach(() => {
    existing = [];
    deleted = [];
    upserted = [];
    querySpecs = [];
    const query = jest.fn(
      (spec: {
        query: string;
        parameters: Array<{ name: string; value: string }>;
      }) => {
        querySpecs.push(spec);
        return { fetchAll: () => Promise.resolve({ resources: existing }) };
      },
    );
    const container = {
      items: {
        query,
        upsert: jest.fn((doc: Record<string, unknown>) => {
          upserted.push(doc);
          return Promise.resolve();
        }),
      },
      item: jest.fn((id: string, partitionKey: unknown) => ({
        delete: () => {
          deleted.push([id, partitionKey]);
          return Promise.resolve();
        },
      })),
    };
    ensureVectorContainer = jest.fn(() => Promise.resolve(container));

    const config = {
      get: jest.fn(
        (key: string) =>
          ({
            'whatsappAgent.promptInjectionRag.container': 'PromptInjectionRag',
            'whatsappAgent.promptInjectionRag.partitionKeyPath': '/injectionId',
          })[key],
      ),
    } as unknown as ConfigService;

    repository = new PromptInjectionRagRepository(
      { ensureVectorContainer } as unknown as CosmosService,
      config,
    );
  });

  it('creates the vector container on first use', async () => {
    await repository.ensureContainer();

    expect(ensureVectorContainer).toHaveBeenCalledWith(
      'PromptInjectionRag',
      '/injectionId',
    );
  });

  it('deletes every existing document of this RAG by its partition key', async () => {
    existing = [
      { id: 'pi-001::0', partitionKey: 'pi-001' },
      { id: 'pi-001::1', partitionKey: 'pi-001' },
      { id: 'pi-002::0', partitionKey: 'pi-002' },
    ];

    await expect(repository.deleteExistingRag()).resolves.toBe(3);
    expect(deleted).toEqual([
      ['pi-001::0', 'pi-001'],
      ['pi-001::1', 'pi-001'],
      ['pi-002::0', 'pi-002'],
    ]);
  });

  it('scopes the purge to this RAG so a shared container is not wiped', async () => {
    await repository.deleteExistingRag();

    const [spec] = querySpecs;
    expect(spec.query).toContain('c.docType = @docType');
    expect(spec.parameters).toEqual([
      { name: '@docType', value: PROMPT_INJECTION_DOC_TYPE },
    ]);
  });

  it('reports zero when there is no existing RAG', async () => {
    await expect(repository.deleteExistingRag()).resolves.toBe(0);
    expect(deleted).toEqual([]);
  });

  it('falls back to the document id when the partition key is absent', async () => {
    existing = [{ id: 'legacy-doc' }];

    await repository.deleteExistingRag();

    expect(deleted).toEqual([['legacy-doc', 'legacy-doc']]);
  });

  it('stamps written chunks with the doc type and a timestamp', async () => {
    const count = await repository.upsertChunks([
      chunk('pi-001::0', 'pi-001'),
      chunk('pi-002::0', 'pi-002'),
    ]);

    expect(count).toBe(2);
    expect(upserted).toHaveLength(2);
    for (const doc of upserted) {
      expect(doc.docType).toBe(PROMPT_INJECTION_DOC_TYPE);
      expect(typeof doc.updatedAt).toBe('string');
      expect(doc.embedding).toEqual([0.1, 0.2]);
    }
  });

  it('does not touch Cosmos when there is nothing to write', async () => {
    await expect(repository.upsertChunks([])).resolves.toBe(0);
    expect(ensureVectorContainer).not.toHaveBeenCalled();
  });
});
