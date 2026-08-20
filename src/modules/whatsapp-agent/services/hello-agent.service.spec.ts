import { FakeListChatModel } from '@langchain/core/utils/testing';
import { HelloAgentService, NO_LLM_REPLY } from './hello-agent.service';
import { AgentModelService } from './agent-model.service';
import {
  LangsmithTracingService,
  TraceOptions,
} from './langsmith-tracing.service';

function serviceWithModel(
  model: FakeListChatModel | undefined,
  tracing: Partial<LangsmithTracingService> = {},
) {
  const stub: Partial<LangsmithTracingService> = {
    traceConfig: () => ({}),
    flushAfterRun: () => Promise.resolve(),
    ...tracing,
  };
  const modelService = {
    isConfigured: () => Boolean(model),
    createModel: () => model,
  } as unknown as AgentModelService;
  return new HelloAgentService(
    modelService,
    stub as unknown as LangsmithTracingService,
  );
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

  it('asks for a trace config and passes it to the agent', async () => {
    let captured: TraceOptions | undefined;
    const service = serviceWithModel(
      new FakeListChatModel({ responses: ['Traced hello'] }),
      {
        traceConfig: (options: TraceOptions) => {
          captured = options;
          return {};
        },
      },
    );
    await expect(service.run('Hello agent')).resolves.toBe('Traced hello');
    expect(captured?.runName).toBe('hello-agent');
    expect(captured?.tags).toContain('hello-agent');
    expect(captured?.metadata).toMatchObject({ agent: 'hello-agent' });
  });

  it('still answers when the tracer cannot be built', async () => {
    const service = serviceWithModel(
      new FakeListChatModel({ responses: ['Untraced hello'] }),
      { traceConfig: () => ({}) },
    );
    await expect(service.run('Hello agent')).resolves.toBe('Untraced hello');
  });

  it('flushes the trace once the turn is done', async () => {
    let flushed = 0;
    const service = serviceWithModel(
      new FakeListChatModel({ responses: ['Flushed hello'] }),
      {
        flushAfterRun: () => {
          flushed += 1;
          return Promise.resolve();
        },
      },
    );
    await expect(service.run('Hello agent')).resolves.toBe('Flushed hello');
    expect(flushed).toBe(1);
  });

  it('flushes the trace of a failed turn as well', async () => {
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
    let flushed = 0;
    const service = serviceWithModel(
      new BrokenModel({ responses: ['unused'] }),
      {
        flushAfterRun: () => {
          flushed += 1;
          return Promise.resolve();
        },
      },
    );
    await expect(service.run('Hello agent')).resolves.toBe(NO_LLM_REPLY);
    expect(flushed).toBe(1);
  });
});
