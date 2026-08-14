import { FakeListChatModel } from '@langchain/core/utils/testing';
import { HelloAgentService, NO_LLM_REPLY } from './hello-agent.service';
import { AgentModelService } from './agent-model.service';

function serviceWithModel(model: FakeListChatModel | undefined) {
  const modelService = {
    isConfigured: () => Boolean(model),
    createModel: () => model,
  } as unknown as AgentModelService;
  return new HelloAgentService(modelService);
}

describe('HelloAgentService', () => {
  it('runs a full deep-agent turn with a tool-capable fake model', async () => {
    const service = serviceWithModel(
      new FakeListChatModel({ responses: ['Hi there, human!'] }),
    );
    await expect(service.run('Hello agent')).resolves.toBe('Hi there, human!');
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
