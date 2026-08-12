import { Injectable, Logger } from '@nestjs/common';
import { createDeepAgent } from 'deepagents';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AgentModelService } from './agent-model.service';
import { CustomerFeedbackService } from './customer-feedback.service';
import { buildCustomerFeedbackCountTool } from '../tools/customer-feedback-count.tool';

const HELLO_SYSTEM_PROMPT =
  'You are a friendly greeter. Before replying, call the ' +
  'get_customer_feedback_count tool to learn how many customer feedback ' +
  'items are in the database, then reply to the user in one short ' +
  'plain-text sentence that greets them and mentions that count.';

/** Reply used whenever no LLM is configured — the service never hard-fails. */
export const NO_LLM_REPLY =
  'Hello! The agent is running, but no language model is configured yet.';

/**
 * Hello-world service proving the deep-agent stack (deepagents on
 * @langchain/langgraph) end to end inside NestJS. The agent carries one tool
 * — the Cosmos customer-feedback counter — and works the count into its
 * greeting. Fails open: any agent, tool, or model error degrades to a static
 * reply instead of surfacing an error.
 */
@Injectable()
export class HelloAgentService {
  private readonly logger = new Logger(HelloAgentService.name);

  constructor(
    private readonly agentModelService: AgentModelService,
    private readonly customerFeedbackService: CustomerFeedbackService,
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
    try {
      const agent = createDeepAgent({
        model,
        systemPrompt: HELLO_SYSTEM_PROMPT,
        tools: [buildCustomerFeedbackCountTool(this.customerFeedbackService)],
      });
      const result = await agent.invoke({
        messages: [{ role: 'user', content: message }],
      });
      const last = result.messages.at(-1);
      const text = typeof last?.content === 'string' ? last.content.trim() : '';
      return text || NO_LLM_REPLY;
    } catch (error) {
      this.logger.warn(`hello agent failed, falling back: ${String(error)}`);
      return NO_LLM_REPLY;
    }
  }
}
