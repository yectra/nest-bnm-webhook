import { FakeListChatModel } from '@langchain/core/utils/testing';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { HelloAgentService, NO_LLM_REPLY } from './hello-agent.service';
import { AgentModelService } from './agent-model.service';
import { CustomerFeedbackService } from './customer-feedback.service';
import {
  CUSTOMER_FEEDBACK_COUNT_TOOL,
  FEEDBACK_COUNT_UNAVAILABLE,
  buildCustomerFeedbackCountTool,
} from '../tools/customer-feedback-count.tool';

function fakeFeedbackService(count: number | Error): CustomerFeedbackService {
  return {
    countFeedbackItems: () =>
      count instanceof Error ? Promise.reject(count) : Promise.resolve(count),
  } as unknown as CustomerFeedbackService;
}

function serviceWithModel(
  model: FakeListChatModel | undefined,
  feedback: CustomerFeedbackService = fakeFeedbackService(0),
) {
  const modelService = {
    isConfigured: () => Boolean(model),
    createModel: () => model,
  } as unknown as AgentModelService;
  return new HelloAgentService(modelService, feedback);
}

/**
 * Scripted fake model: first turn requests the feedback-count tool, second
 * turn echoes the tool's result — proving the tool is actually wired into
 * the deep agent and its output can flow into the reply.
 */
class ToolCallingFakeModel extends FakeListChatModel {
  constructor() {
    super({ responses: ['unused'] });
  }

  override bindTools(): any {
    return this;
  }

  override _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const toolResult = messages.find(
      (m): m is ToolMessage =>
        m instanceof ToolMessage && m.name === CUSTOMER_FEEDBACK_COUNT_TOOL,
    );
    const message = toolResult
      ? new AIMessage({ content: `Hello! ${toolResult.text}` })
      : new AIMessage({
          content: '',
          tool_calls: [
            { name: CUSTOMER_FEEDBACK_COUNT_TOOL, args: {}, id: 'call_1' },
          ],
        });
    return Promise.resolve({ generations: [{ text: '', message }] });
  }
}

describe('HelloAgentService', () => {
  it('runs a full deep-agent turn with a tool-capable fake model', async () => {
    const service = serviceWithModel(
      new FakeListChatModel({ responses: ['Hi there, human!'] }),
    );
    await expect(service.run('Hello agent')).resolves.toBe('Hi there, human!');
  });

  it('exposes the feedback-count tool and works its result into the reply', async () => {
    const service = serviceWithModel(
      new ToolCallingFakeModel(),
      fakeFeedbackService(42),
    );
    await expect(service.run('Hello agent')).resolves.toBe(
      'Hello! There are 42 customer feedback items in the database.',
    );
  });

  it('still replies when the feedback count is unavailable', async () => {
    const service = serviceWithModel(
      new ToolCallingFakeModel(),
      fakeFeedbackService(new Error('cosmos outage')),
    );
    await expect(service.run('Hello agent')).resolves.toBe(
      `Hello! ${FEEDBACK_COUNT_UNAVAILABLE}`,
    );
  });

  it('falls back to the static reply when no model is configured', async () => {
    const service = serviceWithModel(undefined);
    await expect(service.run('Hello agent')).resolves.toBe(NO_LLM_REPLY);
  });

  it('fails open when the model errors', async () => {
    // FakeListChatModel.bindTools clones into a fresh working model, so the
    // broken model must survive binding to reach the agent's model node.
    class BrokenModel extends FakeListChatModel {
      override bindTools(): any {
        return this;
      }
      override _generate(): Promise<never> {
        return Promise.reject(new Error('model outage'));
      }
      override _streamResponseChunks(): AsyncGenerator<never> {
        throw new Error('model outage');
      }
    }
    const service = serviceWithModel(
      new BrokenModel({ responses: ['unused'] }),
    );
    await expect(service.run('Hello agent')).resolves.toBe(NO_LLM_REPLY);
  });
});

describe('buildCustomerFeedbackCountTool', () => {
  it('returns the count from the feedback service', async () => {
    const tool = buildCustomerFeedbackCountTool(fakeFeedbackService(7));
    await expect(tool.invoke({})).resolves.toBe(
      'There are 7 customer feedback items in the database.',
    );
  });

  it('fails open when Cosmos is unreachable', async () => {
    const tool = buildCustomerFeedbackCountTool(
      fakeFeedbackService(new Error('cosmos outage')),
    );
    await expect(tool.invoke({})).resolves.toBe(FEEDBACK_COUNT_UNAVAILABLE);
  });
});
