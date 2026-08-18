import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import { awaitAllCallbacks } from '@langchain/core/callbacks/promises';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Client } from 'langsmith';

/** Per-run trace annotations attached to the LangSmith run tree. */
export interface TraceOptions {
  /** Name of the root run as it appears in the LangSmith trace list. */
  runName: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Sends deep-agent traces to LangSmith.
 *
 * Tracing is opt-in and keyed on LANGSMITH_API_KEY: with no key configured
 * no client is built, no callback is attached, and nothing leaves the
 * process. Tracing is also strictly best-effort — a LangSmith outage or a
 * bad configuration degrades to "no trace" instead of failing the request.
 *
 * The tracer is passed per invocation as a callback rather than enabled
 * globally through LANGSMITH_TRACING, so only the runs we opt in are sent.
 */
@Injectable()
export class LangsmithTracingService implements OnApplicationShutdown {
  private readonly logger = new Logger(LangsmithTracingService.name);
  private client?: Client;
  /** Latches on after a hard failure so we stop retrying every request. */
  private failed = false;

  constructor(private readonly configService: ConfigService) {}

  /** True only when a LangSmith API key is configured and tracing is on. */
  isEnabled(): boolean {
    if (this.failed) {
      return false;
    }
    const enabled = this.configService.get<boolean>(
      'whatsappAgent.langsmith.enabled',
    );
    return enabled !== false && Boolean(this.apiKey());
  }

  /**
   * Runnable config for one agent invocation: a LangSmith tracer plus run
   * name, tags and metadata. Returns an EMPTY config when tracing is off,
   * which callers can pass to `invoke` unchanged.
   */
  traceConfig(options: TraceOptions): RunnableConfig {
    const client = this.getClient();
    if (!client) {
      return {};
    }
    try {
      const tracer = new LangChainTracer({
        projectName: this.configService.get<string>(
          'whatsappAgent.langsmith.project',
        ),
        client,
      });
      return {
        callbacks: [tracer],
        runName: options.runName,
        tags: options.tags,
        metadata: options.metadata,
      };
    } catch (error) {
      this.logger.warn(`langsmith tracer unavailable: ${String(error)}`);
      this.failed = true;
      return {};
    }
  }

  /**
   * Waits for traces queued in the background. Traces are batched off the
   * request path, so this only matters when the process is about to exit.
   */
  async flush(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      await awaitAllCallbacks();
      await this.client.awaitPendingTraceBatches();
    } catch (error) {
      this.logger.warn(`langsmith flush failed: ${String(error)}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.flush();
  }

  private apiKey(): string | undefined {
    return this.configService.get<string>('whatsappAgent.langsmith.apiKey');
  }

  /** Builds the LangSmith client once; undefined means "do not trace". */
  private getClient(): Client | undefined {
    if (!this.isEnabled()) {
      return undefined;
    }
    if (this.client) {
      return this.client;
    }
    const apiUrl = this.configService.get<string>(
      'whatsappAgent.langsmith.endpoint',
    );
    try {
      this.client = new Client({
        apiKey: this.apiKey(),
        ...(apiUrl ? { apiUrl } : {}),
      });
      this.logger.log(
        `langsmith tracing enabled for project "${this.configService.get<string>(
          'whatsappAgent.langsmith.project',
        )}"`,
      );
    } catch (error) {
      this.logger.warn(`langsmith client unavailable: ${String(error)}`);
      this.failed = true;
      return undefined;
    }
    return this.client;
  }
}
