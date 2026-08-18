import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Client } from 'langsmith';

export interface TraceRun {
  /** Root run id — the LangSmith correlation key, logged with the result. */
  runId: string;
  /** LangSmith project the run is written to, null when tracing is off. */
  project: string | null;
  /** Config to pass to the agent invocation (callbacks + run metadata). */
  config: RunnableConfig;
}

/**
 * LangSmith tracing for the WhatsApp deep agent.
 *
 * The tracer is attached explicitly per run rather than relying on the ambient
 * LANGSMITH_TRACING environment switch, so the trace carries the run name,
 * tags, and event metadata this app cares about, and so a run id exists to log
 * alongside the result in Azure. Tracing is optional: with no API key the
 * agent runs untraced instead of failing.
 */
@Injectable()
export class LangsmithTraceService {
  private readonly logger = new Logger(LangsmithTraceService.name);
  private client?: Client;
  private clientFailed = false;

  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    return Boolean(
      this.configService.get<boolean>('whatsappAgent.langsmith.enabled') &&
      this.configService.get<string>('whatsappAgent.langsmith.apiKey'),
    );
  }

  getProject(): string {
    return (
      this.configService.get<string>('whatsappAgent.langsmith.project') ||
      'bnm-whatsapp-agent'
    );
  }

  /**
   * Build the run configuration for one agent turn. Always returns a run id,
   * even when tracing is disabled, so the Azure log record has a stable
   * correlation key either way.
   */
  startRun(options: {
    runName: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): TraceRun {
    const runId = randomUUID();
    const config: RunnableConfig = {
      runId,
      runName: options.runName,
      tags: options.tags ?? [],
      metadata: options.metadata ?? {},
    };

    const tracer = this.createTracer(options.metadata, options.tags);
    if (!tracer) {
      return { runId, project: null, config };
    }

    return {
      runId,
      project: this.getProject(),
      config: { ...config, callbacks: [tracer] },
    };
  }

  /**
   * Flush queued trace batches. Traces are uploaded in the background, so a
   * short-lived request path must wait for them or they are lost when the
   * worker goes idle. Never throws.
   */
  async flush(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      await this.client.awaitPendingTraceBatches();
    } catch (error) {
      this.logger.warn(`LangSmith trace flush failed: ${String(error)}`);
    }
  }

  private createTracer(
    metadata?: Record<string, unknown>,
    tags?: string[],
  ): LangChainTracer | undefined {
    const client = this.getClient();
    if (!client) {
      return undefined;
    }
    try {
      return new LangChainTracer({
        client,
        projectName: this.getProject(),
        metadata,
        tags,
      });
    } catch (error) {
      this.logger.warn(`LangSmith tracer unavailable: ${String(error)}`);
      return undefined;
    }
  }

  private getClient(): Client | undefined {
    if (!this.isEnabled() || this.clientFailed) {
      return undefined;
    }
    if (!this.client) {
      try {
        this.client = new Client({
          apiKey: this.configService.get<string>(
            'whatsappAgent.langsmith.apiKey',
          ),
          apiUrl: this.configService.get<string>(
            'whatsappAgent.langsmith.apiUrl',
          ),
        });
      } catch (error) {
        // One failure is enough: do not retry the constructor per request.
        this.clientFailed = true;
        this.logger.warn(`LangSmith client unavailable: ${String(error)}`);
        return undefined;
      }
    }
    return this.client;
  }
}
