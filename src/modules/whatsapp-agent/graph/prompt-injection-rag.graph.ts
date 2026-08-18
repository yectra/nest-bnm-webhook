import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { END, START, StateGraph } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';

import { EmbeddingService } from '../../embedding/embedding.service';
import { PromptInjectionRagRepository } from '../repositories/prompt-injection-rag.repository';
import { PromptInjectionResourceService } from '../services/prompt-injection-resource.service';
import type {
  EmbeddedPromptInjectionChunk,
  PromptInjectionChunk,
} from '../interfaces/prompt-injection.interface';
import { splitText } from './chunking.util';
import {
  PromptInjectionRagStateAnnotation,
  type PromptInjectionRagState,
} from './prompt-injection-rag.state';

/** Node names, also the span names shown in LangSmith. */
export const RAG_NODES = {
  LOAD: 'loadCorpus',
  CHUNK: 'chunkCorpus',
  EMBED: 'embedChunks',
  PURGE: 'deleteExistingRag',
  PERSIST: 'persistRag',
} as const;

/** Minimal invocable surface of the compiled graph used by the service. */
export interface CompiledPromptInjectionRagGraph {
  invoke(
    input: Partial<PromptInjectionRagState>,
    config?: RunnableConfig,
  ): Promise<PromptInjectionRagState>;
}

/**
 * Builds the LangGraph that rebuilds the known-prompt-injection RAG:
 *
 *   START -> loadCorpus -> chunkCorpus -> embedChunks
 *         -> deleteExistingRag -> persistRag -> END
 *
 * The purge sits *after* embedding on purpose: loading, chunking and embedding
 * are the steps that can fail on a bad deployment or an Azure OpenAI outage,
 * and failing there leaves the previous corpus in place rather than leaving the
 * guard with no RAG at all. Once the vectors are in hand, delete-then-write is
 * atomic enough for a corpus this size.
 */
@Injectable()
export class PromptInjectionRagGraphFactory {
  private readonly logger = new Logger(PromptInjectionRagGraphFactory.name);

  constructor(
    private readonly resourceService: PromptInjectionResourceService,
    private readonly embeddingService: EmbeddingService,
    private readonly repository: PromptInjectionRagRepository,
    private readonly configService: ConfigService,
  ) {}

  build(): CompiledPromptInjectionRagGraph {
    const graph = new StateGraph(PromptInjectionRagStateAnnotation)
      .addNode(RAG_NODES.LOAD, () => this.loadCorpus())
      .addNode(RAG_NODES.CHUNK, (state) => this.chunkCorpus(state))
      .addNode(RAG_NODES.EMBED, (state) => this.embedChunks(state))
      .addNode(RAG_NODES.PURGE, () => this.deleteExistingRag())
      .addNode(RAG_NODES.PERSIST, (state) => this.persistRag(state))
      .addEdge(START, RAG_NODES.LOAD)
      .addEdge(RAG_NODES.LOAD, RAG_NODES.CHUNK)
      .addEdge(RAG_NODES.CHUNK, RAG_NODES.EMBED)
      .addEdge(RAG_NODES.EMBED, RAG_NODES.PURGE)
      .addEdge(RAG_NODES.PURGE, RAG_NODES.PERSIST)
      .addEdge(RAG_NODES.PERSIST, END);

    return graph.compile();
  }

  /** Read the versioned corpus from the bundled resource file. */
  private loadCorpus(): Partial<PromptInjectionRagState> {
    const corpus = this.resourceService.load();
    this.logger.log(
      `Loaded ${corpus.injections.length} known prompt injection(s) from resource v${corpus.version}`,
    );
    return {
      corpusVersion: corpus.version,
      records: corpus.injections,
    };
  }

  /** Render each record to text and split it into overlapping chunks. */
  private chunkCorpus(
    state: PromptInjectionRagState,
  ): Partial<PromptInjectionRagState> {
    const chunkSize =
      this.configService.get<number>(
        'whatsappAgent.promptInjectionRag.chunkSize',
      ) ?? 800;
    const chunkOverlap =
      this.configService.get<number>(
        'whatsappAgent.promptInjectionRag.chunkOverlap',
      ) ?? 120;

    const chunks: PromptInjectionChunk[] = [];
    for (const record of state.records) {
      const parts = splitText(
        this.resourceService.toDocument(record),
        chunkSize,
        chunkOverlap,
      );
      parts.forEach((content, chunkIndex) => {
        chunks.push({
          id: `${record.id}::${chunkIndex}`,
          injectionId: record.id,
          category: record.category,
          severity: record.severity,
          title: record.title,
          recommendedAction: record.recommendedAction,
          corpusVersion: state.corpusVersion,
          chunkIndex,
          chunkCount: parts.length,
          content,
        });
      });
    }

    this.logger.log(
      `Chunked ${state.records.length} record(s) into ${chunks.length} chunk(s)`,
    );
    return { chunks };
  }

  /** Embed the chunks in batches, preserving order. */
  private async embedChunks(
    state: PromptInjectionRagState,
  ): Promise<Partial<PromptInjectionRagState>> {
    if (state.chunks.length === 0) {
      return {
        embeddedChunks: [],
        errors: ['No chunks produced from the prompt-injection corpus'],
      };
    }

    const batchSize = Math.max(
      1,
      this.configService.get<number>(
        'whatsappAgent.promptInjectionRag.embedBatchSize',
      ) ?? 16,
    );

    const embeddedChunks: EmbeddedPromptInjectionChunk[] = [];
    for (let start = 0; start < state.chunks.length; start += batchSize) {
      const batch = state.chunks.slice(start, start + batchSize);
      const vectors = await this.embeddingService.embedMany(
        batch.map((chunk) => chunk.content),
      );
      batch.forEach((chunk, index) => {
        embeddedChunks.push({ ...chunk, embedding: vectors[index] });
      });
    }

    this.logger.log(`Embedded ${embeddedChunks.length} chunk(s)`);
    return { embeddedChunks };
  }

  /** Drop the existing RAG, if any, before the new one is written. */
  private async deleteExistingRag(): Promise<Partial<PromptInjectionRagState>> {
    const deletedCount = await this.repository.deleteExistingRag();
    return { deletedCount };
  }

  /** Write the freshly embedded corpus. */
  private async persistRag(
    state: PromptInjectionRagState,
  ): Promise<Partial<PromptInjectionRagState>> {
    const upsertedCount = await this.repository.upsertChunks(
      state.embeddedChunks,
    );
    return { upsertedCount };
  }
}
