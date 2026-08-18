import { ConfigService } from '@nestjs/config';

import { EmbeddingService } from '../../embedding/embedding.service';
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';

import {
  PromptInjectionRagGraphFactory,
  RAG_NODES,
} from '../graph/prompt-injection-rag.graph';
import { PromptInjectionRagRepository } from '../repositories/prompt-injection-rag.repository';
import { LangsmithTracingService } from './langsmith-tracing.service';
import {
  PromptInjectionRagService,
  RAG_RUN_NAME,
} from './prompt-injection-rag.service';
import { PromptInjectionResourceService } from './prompt-injection-resource.service';
import type { EmbeddedPromptInjectionChunk } from '../interfaces/prompt-injection.interface';

const RAG_CONFIG: Record<string, unknown> = {
  'whatsappAgent.promptInjectionRag.chunkSize': 400,
  'whatsappAgent.promptInjectionRag.chunkOverlap': 60,
  'whatsappAgent.promptInjectionRag.embedBatchSize': 4,
};

/** Deterministic stand-in for Azure OpenAI: one vector per input, order kept. */
function fakeEmbeddings(texts: string[]): number[][] {
  return texts.map((text) => [text.length, 0, 1]);
}

describe('PromptInjectionRagService', () => {
  let configService: ConfigService;
  let embeddingService: jest.Mocked<Pick<EmbeddingService, 'embedMany'>>;
  let repository: jest.Mocked<
    Pick<
      PromptInjectionRagRepository,
      'deleteExistingRag' | 'upsertChunks' | 'getContainerName'
    >
  >;
  let tracingService: jest.Mocked<
    Pick<LangsmithTracingService, 'isEnabled' | 'traceConfig' | 'flushAfterRun'>
  >;
  let written: EmbeddedPromptInjectionChunk[];

  function createService(): PromptInjectionRagService {
    const factory = new PromptInjectionRagGraphFactory(
      new PromptInjectionResourceService(),
      embeddingService as unknown as EmbeddingService,
      repository as unknown as PromptInjectionRagRepository,
      configService,
    );
    return new PromptInjectionRagService(
      factory,
      repository as unknown as PromptInjectionRagRepository,
      tracingService as unknown as LangsmithTracingService,
    );
  }

  beforeEach(() => {
    written = [];
    configService = {
      get: jest.fn((key: string) => RAG_CONFIG[key]),
    } as unknown as ConfigService;

    embeddingService = {
      embedMany: jest.fn((texts: string[]) =>
        Promise.resolve(fakeEmbeddings(texts)),
      ),
    };

    repository = {
      deleteExistingRag: jest.fn(() => Promise.resolve(7)),
      upsertChunks: jest.fn((chunks: EmbeddedPromptInjectionChunk[]) => {
        written = chunks;
        return Promise.resolve(chunks.length);
      }),
      getContainerName: jest.fn(() => 'PromptInjectionRag'),
    };

    tracingService = {
      isEnabled: jest.fn(() => true),
      traceConfig: jest.fn(() => ({})),
      flushAfterRun: jest.fn(() => Promise.resolve()),
    };
  });

  it('deletes the existing RAG and writes the chunked corpus', async () => {
    const result = await createService().rebuild('evt-1');

    expect(result.status).toBe('success');
    expect(result.injectionCount).toBeGreaterThan(0);
    expect(result.chunkCount).toBeGreaterThanOrEqual(result.injectionCount);
    expect(result.deletedCount).toBe(7);
    expect(result.upsertedCount).toBe(result.chunkCount);
    expect(result.corpusVersion).toBeTruthy();
    expect(result.errors).toEqual([]);
  });

  it('deletes the existing RAG only after the new vectors are in hand', async () => {
    const order: string[] = [];
    embeddingService.embedMany.mockImplementation((texts: string[]) => {
      order.push('embed');
      return Promise.resolve(fakeEmbeddings(texts));
    });
    repository.deleteExistingRag.mockImplementation(() => {
      order.push('delete');
      return Promise.resolve(7);
    });
    repository.upsertChunks.mockImplementation((chunks) => {
      order.push('upsert');
      return Promise.resolve(chunks.length);
    });

    await createService().rebuild();

    expect(order[order.length - 2]).toBe('delete');
    expect(order[order.length - 1]).toBe('upsert');
    expect(order.indexOf('embed')).toBeLessThan(order.indexOf('delete'));
  });

  it('writes one embedded chunk per chunk, with stable ids and metadata', async () => {
    await createService().rebuild();

    expect(written.length).toBeGreaterThan(0);
    expect(new Set(written.map((chunk) => chunk.id)).size).toBe(written.length);
    for (const chunk of written) {
      expect(chunk.id).toBe(`${chunk.injectionId}::${chunk.chunkIndex}`);
      expect(chunk.embedding).toEqual([chunk.content.length, 0, 1]);
      expect(chunk.content.length).toBeLessThanOrEqual(400);
      expect(chunk.category).toBeTruthy();
      expect(chunk.recommendedAction).toBeTruthy();
      expect(chunk.corpusVersion).toBeTruthy();
    }
  });

  it('labels the run for LangSmith through the shared tracing service', async () => {
    await createService().rebuild('evt-9');

    expect(tracingService.traceConfig).toHaveBeenCalledWith({
      runName: RAG_RUN_NAME,
      tags: ['whatsapp-agent', 'prompt-injection-rag'],
      metadata: { eventId: 'evt-9', container: 'PromptInjectionRag' },
    });
  });

  it('embeds in batches of the configured size', async () => {
    await createService().rebuild();

    for (const call of embeddingService.embedMany.mock.calls) {
      expect(call[0].length).toBeLessThanOrEqual(4);
    }
  });

  it('sends the run to LangSmith when tracing is configured', async () => {
    const runs: Array<Record<string, unknown>> = [];
    const client = {
      createRun: jest.fn((run: Record<string, unknown>) => {
        runs.push(run);
        return Promise.resolve();
      }),
      updateRun: jest.fn(() => Promise.resolve()),
      awaitPendingTraceBatches: jest.fn(() => Promise.resolve()),
    };
    tracingService.traceConfig.mockReturnValue({
      callbacks: [
        new LangChainTracer({
          client: client as never,
          projectName: 'test-project',
        }),
      ],
      runName: RAG_RUN_NAME,
    });

    const result = await createService().rebuild('evt-2');

    expect(result.status).toBe('success');
    expect(result.traced).toBe(true);
    expect(tracingService.flushAfterRun).toHaveBeenCalled();

    // The whole rebuild is one trace, with a span per graph node.
    const names = runs.map((run) => run.name);
    expect(names).toContain(RAG_RUN_NAME);
    for (const node of Object.values(RAG_NODES)) {
      expect(names).toContain(node);
    }
    // LangSmith names the destination project `session_name` on the wire.
    expect(runs.every((run) => run.session_name === 'test-project')).toBe(true);
    expect(new Set(runs.map((run) => run.trace_id)).size).toBe(1);
  });

  it('reports untraced runs instead of failing when no API key is set', async () => {
    // With no key the shared tracing service hands back an empty config.
    tracingService.isEnabled.mockReturnValue(false);
    tracingService.traceConfig.mockReturnValue({});

    const result = await createService().rebuild();

    expect(result.traced).toBe(false);
    expect(result.status).toBe('success');
  });

  it('reports a failed rebuild instead of throwing when Cosmos is unavailable', async () => {
    repository.deleteExistingRag.mockRejectedValue(new Error('cosmos down'));

    const result = await createService().rebuild();

    expect(result.status).toBe('failed');
    expect(result.errors.join(' ')).toContain('cosmos down');
    expect(repository.upsertChunks).not.toHaveBeenCalled();
    expect(tracingService.flushAfterRun).toHaveBeenCalled();
  });

  it('reports a failed rebuild when embedding fails, leaving the RAG untouched', async () => {
    embeddingService.embedMany.mockRejectedValue(new Error('embedding down'));

    const result = await createService().rebuild();

    expect(result.status).toBe('failed');
    expect(result.errors.join(' ')).toContain('embedding down');
    expect(repository.deleteExistingRag).not.toHaveBeenCalled();
    expect(repository.upsertChunks).not.toHaveBeenCalled();
  });
});
