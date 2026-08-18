import { ConfigService } from '@nestjs/config';
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import { Client } from 'langsmith';
import { LangsmithTracingService } from './langsmith-tracing.service';

function serviceWith(values: Record<string, unknown>) {
  const configService = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
  return new LangsmithTracingService(configService);
}

const WITH_KEY = {
  'whatsappAgent.langsmith.apiKey': 'ls-test-key',
  'whatsappAgent.langsmith.project': 'test-project',
  'whatsappAgent.langsmith.enabled': true,
};

describe('LangsmithTracingService', () => {
  it('sends no trace when no API key is configured', () => {
    const service = serviceWith({
      'whatsappAgent.langsmith.project': 'test-project',
      'whatsappAgent.langsmith.enabled': true,
    });
    expect(service.isEnabled()).toBe(false);
    expect(service.traceConfig({ runName: 'hello-agent' })).toEqual({});
  });

  it('sends no trace when tracing is explicitly disabled', () => {
    const service = serviceWith({
      ...WITH_KEY,
      'whatsappAgent.langsmith.enabled': false,
    });
    expect(service.isEnabled()).toBe(false);
    expect(service.traceConfig({ runName: 'hello-agent' })).toEqual({});
  });

  it('attaches a LangSmith tracer when an API key is configured', () => {
    const service = serviceWith(WITH_KEY);
    expect(service.isEnabled()).toBe(true);

    const config = service.traceConfig({
      runName: 'hello-agent',
      tags: ['hello-agent'],
      metadata: { agent: 'hello-agent' },
    });

    expect(config.runName).toBe('hello-agent');
    expect(config.tags).toEqual(['hello-agent']);
    expect(config.metadata).toEqual({ agent: 'hello-agent' });
    const [tracer] = config.callbacks as LangChainTracer[];
    expect(tracer).toBeInstanceOf(LangChainTracer);
    expect(tracer.projectName).toBe('test-project');
  });

  it('reuses one LangSmith client across invocations', () => {
    const service = serviceWith(WITH_KEY);
    const first = service.traceConfig({ runName: 'hello-agent' });
    const second = service.traceConfig({ runName: 'hello-agent' });
    const [firstTracer] = first.callbacks as LangChainTracer[];
    const [secondTracer] = second.callbacks as LangChainTracer[];
    expect(firstTracer).not.toBe(secondTracer);
    expect(firstTracer.client).toBe(secondTracer.client);
  });

  it('flushes nothing when tracing never started', async () => {
    const service = serviceWith({});
    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
  });

  it('swallows flush failures on shutdown', async () => {
    const service = serviceWith(WITH_KEY);
    const config = service.traceConfig({ runName: 'hello-agent' });
    const [tracer] = config.callbacks as LangChainTracer[];
    const client = tracer.client as Client;
    jest
      .spyOn(client, 'awaitPendingTraceBatches')
      .mockRejectedValue(new Error('langsmith down'));
    await expect(service.flush()).resolves.toBeUndefined();
  });
});
