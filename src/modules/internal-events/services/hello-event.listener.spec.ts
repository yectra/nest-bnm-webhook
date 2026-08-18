import { ConfigService } from '@nestjs/config';
import type { ServiceBusReceivedMessage } from '@azure/service-bus';

import { HelloEventListener } from './hello-event.listener';
import { HelloEventService } from './hello-event.service';

interface MessageHandlers {
  processMessage: (message: ServiceBusReceivedMessage) => Promise<void>;
}

const receiver = {
  subscribe: jest.fn<{ close(): Promise<void> }, [MessageHandlers, unknown]>(),
  completeMessage: jest.fn().mockResolvedValue(undefined),
  abandonMessage: jest.fn().mockResolvedValue(undefined),
  deadLetterMessage: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
};

const client = {
  createReceiver: jest.fn().mockReturnValue(receiver),
  close: jest.fn().mockResolvedValue(undefined),
};

const serviceBusClientMock: jest.Mock<typeof client, unknown[]> = jest.fn(
  () => client,
);

jest.mock('@azure/service-bus', () => ({
  ServiceBusClient: jest
    .fn()
    .mockImplementation((...args: unknown[]) => serviceBusClientMock(...args)),
}));

jest.mock('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn().mockImplementation(() => ({
    kind: 'managed-identity',
  })),
}));

const buildListener = (overrides: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = {
    'eventListener.enabled': true,
    'eventListener.connectionString': 'Endpoint=sb://test/;SharedAccessKey=k',
    'eventListener.queue': 'hello-events',
    'eventListener.maxConcurrentCalls': 1,
    ...overrides,
  };

  const config = {
    get: jest.fn((path: string) => values[path]),
  } as unknown as ConfigService;

  const helloEventService = new HelloEventService();
  const handle = jest.spyOn(helloEventService, 'handle');

  return {
    listener: new HelloEventListener(helloEventService, config),
    handle,
  };
};

/** Runs the handler the listener registered with Service Bus. */
const deliver = async (body: unknown, messageId = 'msg-1'): Promise<void> => {
  const [handlers] = receiver.subscribe.mock.calls[0];

  await handlers.processMessage({
    body,
    messageId,
  } as ServiceBusReceivedMessage);
};

describe('HelloEventListener', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    client.createReceiver.mockReturnValue(receiver);
    serviceBusClientMock.mockImplementation(() => client);
  });

  it('does not connect while disabled', () => {
    const { listener } = buildListener({ 'eventListener.enabled': false });

    listener.onModuleInit();

    expect(serviceBusClientMock).not.toHaveBeenCalled();
    expect(receiver.subscribe).not.toHaveBeenCalled();
  });

  it('receives from a queue in peekLock mode', () => {
    const { listener } = buildListener();

    listener.onModuleInit();

    expect(client.createReceiver).toHaveBeenCalledWith('hello-events', {
      receiveMode: 'peekLock',
    });
    expect(receiver.subscribe).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        autoCompleteMessages: false,
        maxConcurrentCalls: 1,
      }),
    );
  });

  it('receives from a topic subscription when configured', () => {
    const { listener } = buildListener({
      'eventListener.queue': undefined,
      'eventListener.topic': 'hello-topic',
      'eventListener.subscription': 'hello-sub',
    });

    listener.onModuleInit();

    expect(client.createReceiver).toHaveBeenCalledWith(
      'hello-topic',
      'hello-sub',
      { receiveMode: 'peekLock' },
    );
  });

  it('uses managed identity when only a namespace is configured', () => {
    const { listener } = buildListener({
      'eventListener.connectionString': undefined,
      'eventListener.namespace': 'contoso.servicebus.windows.net',
    });

    listener.onModuleInit();

    expect(serviceBusClientMock).toHaveBeenCalledWith(
      'contoso.servicebus.windows.net',
      expect.objectContaining({ kind: 'managed-identity' }),
    );
  });

  it('stays idle when no source entity is configured', () => {
    const { listener } = buildListener({ 'eventListener.queue': undefined });

    listener.onModuleInit();

    expect(serviceBusClientMock).not.toHaveBeenCalled();
  });

  it('stays idle when no credential is configured', () => {
    const { listener } = buildListener({
      'eventListener.connectionString': undefined,
      'eventListener.namespace': undefined,
    });

    listener.onModuleInit();

    expect(receiver.subscribe).not.toHaveBeenCalled();
  });

  it('greets an event and completes the message', async () => {
    const { listener, handle } = buildListener();
    listener.onModuleInit();

    await deliver([{ id: 'evt-1', eventType: 'Bnm.Hello' }]);

    expect(handle).toHaveBeenCalledWith([
      { id: 'evt-1', eventType: 'Bnm.Hello' },
    ]);
    expect(receiver.completeMessage).toHaveBeenCalled();
    expect(receiver.abandonMessage).not.toHaveBeenCalled();
  });

  it('parses a JSON string body', async () => {
    const { listener, handle } = buildListener();
    listener.onModuleInit();

    await deliver(JSON.stringify({ id: 'evt-2', type: 'Bnm.Hello.Cloud' }));

    expect(handle).toHaveBeenCalledWith({
      id: 'evt-2',
      type: 'Bnm.Hello.Cloud',
    });
    expect(receiver.completeMessage).toHaveBeenCalled();
  });

  it('parses a byte-array body', async () => {
    const { listener, handle } = buildListener();
    listener.onModuleInit();

    await deliver(Buffer.from(JSON.stringify({ id: 'evt-3' }), 'utf8'));

    expect(handle).toHaveBeenCalledWith({ id: 'evt-3' });
    expect(receiver.completeMessage).toHaveBeenCalled();
  });

  it('dead-letters a body that is not a JSON event', async () => {
    const { listener, handle } = buildListener();
    listener.onModuleInit();

    await deliver('not json at all');

    expect(handle).not.toHaveBeenCalled();
    expect(receiver.deadLetterMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deadLetterReason: 'InvalidPayload' }),
    );
    expect(receiver.completeMessage).not.toHaveBeenCalled();
  });

  it('abandons the message when handling throws, so it is redelivered', async () => {
    const { listener, handle } = buildListener();
    handle.mockImplementation(() => {
      throw new Error('boom');
    });
    listener.onModuleInit();

    await deliver([{ id: 'evt-4' }]);

    expect(receiver.abandonMessage).toHaveBeenCalled();
    expect(receiver.completeMessage).not.toHaveBeenCalled();
  });

  it('closes the receiver and client on shutdown', async () => {
    const subscription = { close: jest.fn().mockResolvedValue(undefined) };
    receiver.subscribe.mockReturnValue(subscription);

    const { listener } = buildListener();
    listener.onModuleInit();
    await listener.onModuleDestroy();

    expect(subscription.close).toHaveBeenCalled();
    expect(receiver.close).toHaveBeenCalled();
    expect(client.close).toHaveBeenCalled();
  });

  it('closes cleanly when it never connected', async () => {
    const { listener } = buildListener({ 'eventListener.enabled': false });
    listener.onModuleInit();

    await expect(listener.onModuleDestroy()).resolves.toBeUndefined();
  });
});
