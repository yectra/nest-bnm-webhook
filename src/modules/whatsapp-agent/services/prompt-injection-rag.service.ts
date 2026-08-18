import { Injectable, Logger } from '@nestjs/common';

import {
  PromptInjectionRagGraphFactory,
  type CompiledPromptInjectionRagGraph,
} from '../graph/prompt-injection-rag.graph';
import { PromptInjectionRagRepository } from '../repositories/prompt-injection-rag.repository';
import { LangsmithTracingService } from './langsmith-tracing.service';
import type { PromptInjectionRagResult } from '../interfaces/prompt-injection.interface';

/** Trace name the run appears under in LangSmith. */
export const RAG_RUN_NAME = 'whatsapp-agent:update-prompt-injection-rag';

/**
 * Runs the prompt-injection RAG rebuild.
 *
 * Owns the graph lifecycle, attaches the shared LangSmith tracing config to
 * the run, and turns the finished graph state into the summary returned to the
 * Event Grid caller.
 * The rebuild never throws: a failure is reported as a `failed` result so the
 * webhook still answers Event Grid and the delivery is not retried into a
 * loop by an exception.
 */
@Injectable()
export class PromptInjectionRagService {
  private readonly logger = new Logger(PromptInjectionRagService.name);
  private graph?: CompiledPromptInjectionRagGraph;

  constructor(
    private readonly graphFactory: PromptInjectionRagGraphFactory,
    private readonly repository: PromptInjectionRagRepository,
    private readonly tracingService: LangsmithTracingService,
  ) {}

  /**
   * Rebuild the RAG: load the known injections, chunk and embed them, delete
   * the existing corpus in Cosmos DB, and write the new one.
   *
   * @param eventId Event Grid id, recorded on the trace for correlation.
   */
  async rebuild(eventId?: string): Promise<PromptInjectionRagResult> {
    const startedAt = Date.now();
    const traced = this.tracingService.isEnabled();

    try {
      const state = await this.getGraph().invoke(
        {},
        this.tracingService.traceConfig({
          runName: RAG_RUN_NAME,
          tags: ['whatsapp-agent', 'prompt-injection-rag'],
          metadata: {
            eventId: eventId ?? 'manual',
            container: this.repository.getContainerName(),
          },
        }),
      );

      const result: PromptInjectionRagResult = {
        status: state.errors.length > 0 ? 'failed' : 'success',
        corpusVersion: state.corpusVersion,
        injectionCount: state.records.length,
        chunkCount: state.chunks.length,
        deletedCount: state.deletedCount,
        upsertedCount: state.upsertedCount,
        container: this.repository.getContainerName(),
        traced,
        durationMs: Date.now() - startedAt,
        errors: state.errors,
      };

      this.logger.log(
        `Prompt-injection RAG rebuild ${result.status}: ${result.deletedCount} deleted, ${result.upsertedCount} written (v${result.corpusVersion})`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Prompt-injection RAG rebuild failed: ${String(error)}`,
      );
      return {
        status: 'failed',
        corpusVersion: '',
        injectionCount: 0,
        chunkCount: 0,
        deletedCount: 0,
        upsertedCount: 0,
        container: this.repository.getContainerName(),
        traced,
        durationMs: Date.now() - startedAt,
        errors: [String(error)],
      };
    } finally {
      // No-op unless LANGSMITH_FLUSH_AFTER_RUN is on, in which case the trace
      // is uploaded before the webhook responds instead of being left to the
      // background batch.
      await this.tracingService.flushAfterRun();
    }
  }

  /** The compiled graph is stateless and reused across events. */
  private getGraph(): CompiledPromptInjectionRagGraph {
    this.graph ??= this.graphFactory.build();
    return this.graph;
  }
}
