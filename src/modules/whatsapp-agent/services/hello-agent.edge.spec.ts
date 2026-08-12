import { FakeListChatModel } from '@langchain/core/utils/testing';
import { createDeepAgent } from 'deepagents';
import { HelloAgentService, NO_LLM_REPLY } from './hello-agent.service';
import { AgentModelService } from './agent-model.service';
import { CustomerFeedbackService } from './customer-feedback.service';

jest.mock('deepagents', () => ({ createDeepAgent: jest.fn() }));

/**
 * Edge cases for the reply extraction in HelloAgentService: a real deep agent
 * always ends with a non-empty assistant text message, so these degenerate
 * agent results (no messages, structured content, blank text) are only
 * reachable with a mocked createDeepAgent.
 */
describe('HelloAgentService reply extraction', () => {
  const model = new FakeListChatModel({ responses: ['unused'] });

  function service() {
    return new HelloAgentService(
      { createModel: () => model } as unknown as AgentModelService,
      {} as CustomerFeedbackService,
    );
  }

  function agentReturning(messages: unknown[]) {
    (createDeepAgent as jest.Mock).mockReturnValue({
      invoke: jest.fn().mockResolvedValue({ messages }),
    });
  }

  it('returns trimmed assistant text', async () => {
    agentReturning([{ content: '  Hello from the agent!  ' }]);
    await expect(service().run('Hi')).resolves.toBe('Hello from the agent!');
  });

  it('falls back when the agent returns no messages', async () => {
    agentReturning([]);
    await expect(service().run('Hi')).resolves.toBe(NO_LLM_REPLY);
  });

  it('falls back when the last message content is not a string', async () => {
    agentReturning([{ content: [{ type: 'text', text: 'structured' }] }]);
    await expect(service().run('Hi')).resolves.toBe(NO_LLM_REPLY);
  });

  it('falls back when the assistant text is blank', async () => {
    agentReturning([{ content: '   ' }]);
    await expect(service().run('Hi')).resolves.toBe(NO_LLM_REPLY);
  });
});
