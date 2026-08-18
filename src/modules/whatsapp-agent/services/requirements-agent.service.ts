import { Injectable, Logger } from '@nestjs/common';
import { createDeepAgent } from 'deepagents';
import { tool } from '@langchain/core/tools';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';

import { FoundryModelService } from './foundry-model.service';
import { LangsmithTraceService } from './langsmith-trace.service';
import { CustomerDirectoryService } from './customer-directory.service';
import { looksLikeCustomerNameRequest } from './requirements-event.qualifier';
import type {
  RequirementsAgentResult,
  RequirementsQualification,
} from '../interfaces/requirements-event.interface';

const REQUIREMENTS_SYSTEM_PROMPT = [
  'You are the BNM "Post Your Requirements" WhatsApp assistant.',
  'You answer questions about the customers who submitted requirement forms.',
  '',
  'When the user asks for customer names — "give me all customer names",',
  '"who are the customers", "list the clients who posted requirements", or any',
  'similar request — call the list_customer_names tool and answer from its',
  'result. Never invent a name: if the tool returns no names, say the customer',
  'directory returned no records.',
  '',
  'For anything else, answer briefly from the requirement message itself.',
  'Reply in plain text suitable for WhatsApp: no markdown, at most a short',
  'sentence followed by the names as a simple list.',
].join('\n');

/**
 * Text of the agent's final message. Chat models return either a plain string
 * or a list of content blocks, so both shapes are flattened here.
 */
function extractText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block && typeof block === 'object' && 'text' in block
          ? String((block as { text: unknown }).text)
          : '',
      )
      .join('')
      .trim();
  }
  return '';
}

/** Reply used whenever the agent cannot produce a grounded answer. */
export const NO_ANSWER_REPLY =
  'We received your requirement. Our team will get back to you shortly.';

const NO_CUSTOMERS_REPLY =
  'No customer names are on file for the Post Your Requirements records yet.';

const DIRECTORY_UNAVAILABLE_REPLY =
  'The customer directory could not be reached right now. Please try again shortly.';

/**
 * Deep agent (deepagents on @langchain/langgraph) for qualified
 * "Post Your Requirements" events, backed by the Azure AI Foundry gpt-5-mini
 * deployment and a Cosmos-backed customer-name tool.
 *
 * Fails open at every step: with no Foundry endpoint, or when the model or the
 * tool errors, the turn degrades to a deterministic answer instead of throwing
 * back at the Event Grid delivery.
 */
@Injectable()
export class RequirementsAgentService {
  private readonly logger = new Logger(RequirementsAgentService.name);

  constructor(
    private readonly foundryModelService: FoundryModelService,
    private readonly customerDirectoryService: CustomerDirectoryService,
    private readonly traceService: LangsmithTraceService,
  ) {}

  async run(
    qualification: RequirementsQualification,
  ): Promise<RequirementsAgentResult> {
    const startedAt = Date.now();
    const message = qualification.message?.trim() || '';

    const trace = this.traceService.startRun({
      runName: 'post-your-requirements-agent',
      tags: ['whatsapp', 'post-your-requirements', 'deep-agent'],
      metadata: {
        eventId: qualification.eventId,
        eventType: qualification.eventType,
        matchedOn: qualification.matchedOn,
        conversationId: qualification.conversationId,
        userId: qualification.userId,
        model: this.foundryModelService.getModelName(),
      },
    });

    // Collected by the tool wrapper so the Azure log records what the agent
    // actually read, not just what it said.
    const lookup = { requested: false, names: [] as string[], error: '' };
    const model = this.foundryModelService.createModel();

    let answer: string;
    let degraded = false;

    if (!model) {
      answer = await this.answerWithoutModel(message, lookup);
      degraded = true;
    } else {
      const agentAnswer = await this.answerWithAgent(
        model,
        message,
        lookup,
        trace.config,
      );
      if (agentAnswer) {
        answer = agentAnswer;
      } else {
        answer = await this.answerWithoutModel(message, lookup);
        degraded = true;
      }
    }

    await this.traceService.flush();

    return {
      answer,
      customerNamesRequested: lookup.requested,
      customerNames: lookup.names,
      model: model ? this.foundryModelService.getModelName() : null,
      traceRunId: trace.runId,
      traceProject: trace.project,
      degraded,
      durationMs: Date.now() - startedAt,
    };
  }

  /** One deep-agent turn. Returns undefined when the agent fails to answer. */
  private async answerWithAgent(
    model: BaseChatModel,
    message: string,
    lookup: { requested: boolean; names: string[]; error: string },
    config: RunnableConfig,
  ): Promise<string | undefined> {
    try {
      const agent = createDeepAgent({
        model,
        systemPrompt: REQUIREMENTS_SYSTEM_PROMPT,
        tools: [this.createCustomerNamesTool(lookup)],
      });

      const result = await agent.invoke(
        { messages: [{ role: 'user', content: message || 'Hello' }] },
        config,
      );

      return extractText(result.messages.at(-1)?.content) || undefined;
    } catch (error) {
      this.logger.warn(
        `requirements agent failed, falling back: ${String(error)}`,
      );
      return undefined;
    }
  }

  /**
   * Deterministic path: used when no Foundry deployment is configured and when
   * the agent turn fails. The keyword heuristic only has to cover the obvious
   * phrasings — the model covers the rest when it is available.
   */
  private async answerWithoutModel(
    message: string,
    lookup: { requested: boolean; names: string[]; error: string },
  ): Promise<string> {
    if (!lookup.requested && !looksLikeCustomerNameRequest(message)) {
      return NO_ANSWER_REPLY;
    }

    if (!lookup.requested) {
      const result = await this.customerDirectoryService.listCustomerNames();
      lookup.requested = true;
      lookup.names = result.names;
      lookup.error = result.error ?? '';
    }

    if (lookup.error) {
      return DIRECTORY_UNAVAILABLE_REPLY;
    }
    if (!lookup.names.length) {
      return NO_CUSTOMERS_REPLY;
    }
    return `Customer names on the Post Your Requirements records (${lookup.names.length}):\n${lookup.names
      .map((name) => `- ${name}`)
      .join('\n')}`;
  }

  /** Cosmos-backed tool the deep agent calls for the customer directory. */
  private createCustomerNamesTool(lookup: {
    requested: boolean;
    names: string[];
    error: string;
  }) {
    return tool(
      async (input: { limit?: number }) => {
        const result = await this.customerDirectoryService.listCustomerNames(
          input?.limit,
        );
        lookup.requested = true;
        lookup.names = result.names;
        lookup.error = result.error ?? '';

        if (result.error) {
          return `The customer directory (${result.container}) could not be read: ${result.error}`;
        }
        if (!result.names.length) {
          return `No customer names found in ${result.container}.`;
        }
        return `Customer names (${result.names.length}) from ${result.container}:\n${result.names
          .map((name) => `- ${name}`)
          .join('\n')}`;
      },
      {
        name: 'list_customer_names',
        description:
          'List the distinct customer names on the Post Your Requirements records, most recent first. Use for any request for customer/client names or a customer list.',
        schema: z.object({
          limit: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional()
            .describe('Maximum number of customer records to read.'),
        }),
      },
    );
  }
}
