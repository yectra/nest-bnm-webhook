import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { WhatsappEventController } from './whatsapp-event.controller';
import { WhatsappEventHandlerService } from '../services/whatsapp-event-handler.service';
import { makeMessage } from '../testing/agent-test.helpers';
import { ProcessOutcome, WhatsAppMessage } from '../types';

const EVENT_TYPE = 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT';

function wrap(data: unknown, eventType = EVENT_TYPE) {
  return { id: `evt-${Math.random().toString(36).slice(2)}`, eventType, data };
}

function makeController(
  handle: (message: WhatsAppMessage) => Promise<ProcessOutcome>,
) {
  const handler = { handle } as unknown as WhatsappEventHandlerService;
  const configService = {
    get: () => EVENT_TYPE,
  } as unknown as ConfigService;
  return new WhatsappEventController(handler, configService);
}

class ResponseStub {
  statusCode: number | undefined;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }
}

function makeResponse(): Response & ResponseStub {
  return new ResponseStub() as Response & ResponseStub;
}

describe('WhatsappEventController', () => {
  it('answers the Event Grid subscription validation handshake', async () => {
    const controller = makeController(() =>
      Promise.reject(new Error('should not be called')),
    );
    const result = await controller.receive(
      [
        {
          eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent',
          data: { validationCode: 'abc-123' },
        },
      ],
      makeResponse(),
    );
    expect(result).toEqual({ validationResponse: 'abc-123' });
  });

  it('processes a single (non-array) event object', async () => {
    const controller = makeController((message) =>
      Promise.resolve({
        status: 'replied',
        replySid: 'SMx',
        reply: `to:${message.messageSid}`,
      }),
    );
    const response = makeResponse();
    const result = (await controller.receive(
      wrap(makeMessage()),
      response,
    )) as { results: Array<{ eventId?: string; status: string }> };
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe('replied');
    expect(typeof result.results[0].eventId).toBe('string');
    expect(response.statusCode).toBeUndefined(); // stays 200
  });

  it('processes arrays and ignores foreign event types', async () => {
    const controller = makeController(() =>
      Promise.resolve({ status: 'replied', replySid: 'SMx', reply: 'ok' }),
    );
    const result = await controller.receive(
      [
        wrap(makeMessage({ messageSid: 'SM1' })),
        wrap({ foo: 1 }, 'SOME_OTHER_EVENT'),
        wrap(makeMessage({ messageSid: 'SM2' })),
      ],
      makeResponse(),
    );
    expect(
      (result as { results: Array<{ status: string }> }).results.map(
        (entry) => entry.status,
      ),
    ).toEqual(['replied', 'ignored-event-type', 'replied']);
  });

  it('returns 503 for redelivery when a send fails, without failing the batch', async () => {
    const controller = makeController(() =>
      Promise.resolve({ status: 'send-failed', reply: 'x' }),
    );
    const response = makeResponse();
    const result = await controller.receive([wrap(makeMessage())], response);
    expect(response.statusCode).toBe(503);
    expect(
      (result as { results: Array<{ status: string }> }).results[0].status,
    ).toBe('send-failed');
  });

  it('returns 503 when the handler throws unexpectedly', async () => {
    const controller = makeController(() => Promise.reject(new Error('boom')));
    const response = makeResponse();
    const result = await controller.receive([wrap(makeMessage())], response);
    expect(response.statusCode).toBe(503);
    expect(
      (result as { results: Array<{ status: string }> }).results[0].status,
    ).toBe('error');
  });
});
