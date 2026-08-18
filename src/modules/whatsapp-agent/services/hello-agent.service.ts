import { Injectable, Logger } from '@nestjs/common';
import { createDeepAgent } from 'deepagents';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AgentModelService } from './agent-model.service';
import { LangsmithTracingService } from './langsmith-tracing.service';

const HELLO_SYSTEM_PROMPT =
  'You are a friendly greeter. Reply to the user in one short plain-text sentence.';

/** Reply used whenever no LLM is configured — the service never hard-fails. */
export const NO_LLM_REPLY =
  'Hello! The agent is running, but no language model is configured yet.';

/**
 * Hello-world service proving the deep-agent stack (deepagents on
 * @langchain/langgraph) end to end inside NestJS. Fails open: any agent or
 * model error degrades to the static reply instead of surfacing an error.
 *
 * Each turn is traced to LangSmith when LANGSMITH_API_KEY is set; without a
 * key the invocation runs with an empty config and no trace is sent. With
 * LANGSMITH_FLUSH_AFTER_RUN the trace is uploaded before the reply returns.
 */
@Injectable()
export class HelloAgentService {
  private readonly logger = new Logger(HelloAgentService.name);

  constructor(
    private readonly agentModelService: AgentModelService,
    private readonly langsmithTracingService: LangsmithTracingService,
  ) {}

  async run(message: string): Promise<string> {
    const model = this.agentModelService.createModel();
    return this.runWithModel(message, model);
  }

  async runWithModel(
    message: string,
    model: BaseChatModel | undefined,
  ): Promise<string> {
    if (!model) {
      return NO_LLM_REPLY;
    }
    // Empty config when LangSmith is not configured, so the agent runs
    // exactly as before and nothing is reported.
    const traceConfig = this.langsmithTracingService.traceConfig({
      runName: 'hello-agent',
      tags: ['hello-agent', 'whatsapp-agent'],
      metadata: {
        agent: 'hello-agent',
        model: model.getName(),
        messageLength: message.length,
      },
    });
    try {
      const agent = createDeepAgent({
        model,
        systemPrompt: HELLO_SYSTEM_PROMPT,
      });
      const result = await agent.invoke(
        {
          messages: [{ role: 'user', content: message }],
        },
        traceConfig,
      );
      const last = result.messages.at(-1);
      const text = typeof last?.content === 'string' ? last.content.trim() : '';
      return text || NO_LLM_REPLY;
    } catch (error) {
      this.logger.warn(`hello agent failed, falling back: ${String(error)}`);
      return NO_LLM_REPLY;
    } finally {
      // Only uploads here when LANGSMITH_FLUSH_AFTER_RUN is set; otherwise
      // the trace stays batched off the request path. Failed turns are
      // flushed too — a trace of the failure is the useful one.
      await this.langsmithTracingService.flushAfterRun();
    }
  }
}
