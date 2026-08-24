import { Injectable, Logger } from '@nestjs/common';
import { createDeepAgent } from 'deepagents';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AgentModelService } from './agent-model.service';
import { LangsmithTracingService } from './langsmith-tracing.service';
import type { EventGridEvent } from '../../whatsapp/services/event-grid.service';

/**
 * System prompt for the PostYourRequirements agent.
 * This agent analyses a property requirement received from the BNM Java backend
 * via Azure Event Grid and produces a short, structured acknowledgement/summary
 * that can be stored or forwarded downstream.
 */
const POST_YOUR_REQUIREMENTS_SYSTEM_PROMPT = `You are an intelligent intake assistant for BrickNMortar (BNM), a real-estate platform.

When a customer submits the "Post Your Requirements" form on the website, you receive a payload with the following fields:
- contact: The customer's phone number or email address.
- message: A free-text description of what the customer is looking for (property type, location, budget, preferences, etc.).
- askExpert: The name of the BNM expert or team the customer wants to connect with.
- attachments: Any files or images the customer uploaded (may be empty).
- date: The date the form was submitted.
- userId: The identifier for the customer session (may be "Guest" for anonymous users).

Your job is to:
1. Produce a warm, professional acknowledgement summary (3-5 sentences) confirming what the customer submitted.
2. Extract and highlight any property details mentioned inside the "message" field (e.g. location, budget, BHK, property type).
3. Note which expert they requested via "askExpert".
4. Confirm the contact details so the team can follow up.
5. If the "message" field is empty or vague, politely note that a team member will reach out to gather more details.

Keep the tone friendly and professional. Never invent information not present in the payload.`;

/** Fallback reply when no LLM is configured or the agent errors. */
export const NO_LLM_REPLY_PYR =
  'PostYourRequirements event received, but no language model is configured yet.';

/**
 * Agent service that processes POST_YOUR_REQUIREMENTS events fired by the
 * Java backend through Azure Event Grid.
 *
 * Every invocation is traced to LangSmith when LANGSMITH_API_KEY is set.
 * Failures degrade to the static fallback reply — the service never throws.
 */
@Injectable()
export class PostYourRequirementsAgentService {
  private readonly logger = new Logger(
    PostYourRequirementsAgentService.name,
  );

  constructor(
    private readonly agentModelService: AgentModelService,
    private readonly langsmithTracingService: LangsmithTracingService,
  ) {}

  /**
   * Entry point called by EventGridService when a POST_YOUR_REQUIREMENTS
   * event is received. Accepts the full Event Grid event so metadata such as
   * eventId, subject and eventTime can be attached to the LangSmith trace.
   */
  async processEvent(event: EventGridEvent): Promise<string> {
    console.log(event, 'This is second line within post your requirements agent printing event', 'eventType:', event?.eventType)
    const model = this.agentModelService.createModel();
    return this.runWithModel(event, model);
  }

  async runWithModel(
    event: EventGridEvent,
    model: BaseChatModel | undefined,
  ): Promise<string> {
    if (!model) {
      this.logger.warn(
        `[PostYourRequirements] No LLM configured — returning fallback reply for event ${event.id}`,
      );
      return NO_LLM_REPLY_PYR;
    }

    // Build the user message from the event payload so the agent has full context.
    const userMessage = this.buildUserMessage(event);

    const traceConfig = this.langsmithTracingService.traceConfig({
      runName: 'post-your-requirements-agent',
      tags: ['post-your-requirements', 'event-grid', 'whatsapp-agent'],
      metadata: {
        agent: 'post-your-requirements-agent',
        model: model.getName(),
        eventId: event.id ?? 'unknown',
        eventType: event.eventType ?? 'unknown',
        subject: event.subject ?? event.topic ?? 'unknown',
        eventTime: event.eventTime ?? 'unknown',
        messageLength: userMessage.length,
      },
    });

    try {
      const agent = createDeepAgent({
        model,
        systemPrompt: POST_YOUR_REQUIREMENTS_SYSTEM_PROMPT,
      });

      const result = await agent.invoke(
        {
          messages: [{ role: 'user', content: userMessage }],
        },
        traceConfig,
      );

      const last = result.messages.at(-1);
      const text =
        typeof last?.content === 'string' ? last.content.trim() : '';

      this.logger.log(
        `[PostYourRequirements] Agent completed for event ${event.id}. Reply length: ${text.length}`,
      );

      return text || NO_LLM_REPLY_PYR;
    } catch (error) {
      this.logger.warn(
        `[PostYourRequirements] Agent failed for event ${event.id}, falling back: ${String(error)}`,
      );
      return NO_LLM_REPLY_PYR;
    } finally {
      // Upload the trace synchronously when LANGSMITH_FLUSH_AFTER_RUN is set;
      // otherwise the trace is batched in the background. Failures are flushed
      // too — a trace of the failure is the useful one.
      await this.langsmithTracingService.flushAfterRun();
    }
  }

  /**
   * Converts the raw Event Grid event into a natural-language prompt for the
   * agent, so the LLM sees structured data it can reason over.
   */
  private buildUserMessage(event: EventGridEvent): string {
    const payload = event.data
      ? JSON.stringify(event.data, null, 2)
      : '(no payload data)';

    return (
      `A new property requirement has been submitted via the BNM platform.\n\n` +
      `Event ID   : ${event.id ?? 'N/A'}\n` +
      `Event Type : ${event.eventType ?? 'N/A'}\n` +
      `Event Time : ${event.eventTime ?? 'N/A'}\n` +
      `Subject    : ${event.subject ?? event.topic ?? 'N/A'}\n\n` +
      `Requirement Payload:\n${payload}`
    );
  }
}
