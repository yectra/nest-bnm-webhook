import { HelloEventService } from './hello-event.service';
import type {
  InternalEventAck,
  SubscriptionValidationResponse,
} from '../interfaces/internal-event.interface';

describe('HelloEventService', () => {
  let service: HelloEventService;

  beforeEach(() => {
    service = new HelloEventService();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers the Event Grid subscription validation handshake', () => {
    const result = service.handle([
      {
        id: '1',
        eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent',
        data: { validationCode: 'code-123' },
      },
    ]) as SubscriptionValidationResponse;

    expect(result).toEqual({ validationResponse: 'code-123' });
  });

  it('greets Event Grid schema events', () => {
    const result = service.handle([
      { id: 'evt-1', eventType: 'Bnm.Hello', subject: '/hello' },
    ]) as InternalEventAck;

    expect(result.message).toBe('Hello, world');
    expect(result.receivedCount).toBe(1);
    expect(result.results[0]).toEqual({
      greeting: 'Hello, world from Bnm.Hello',
      eventId: 'evt-1',
      eventType: 'Bnm.Hello',
      status: 'handled',
    });
  });

  it('greets a single CloudEvents payload', () => {
    const result = service.handle({
      id: 'evt-2',
      type: 'Bnm.Hello.CloudEvent',
      source: '/internal/tests',
      specversion: '1.0',
    }) as InternalEventAck;

    expect(result.receivedCount).toBe(1);
    expect(result.results[0].eventType).toBe('Bnm.Hello.CloudEvent');
    expect(result.results[0].greeting).toBe(
      'Hello, world from Bnm.Hello.CloudEvent',
    );
  });

  it('handles a batch of events', () => {
    const result = service.handle([
      { id: 'a', eventType: 'Bnm.Hello' },
      { id: 'b', eventType: 'Bnm.Hello' },
    ]) as InternalEventAck;

    expect(result.receivedCount).toBe(2);
    expect(result.results.map((entry) => entry.eventId)).toEqual(['a', 'b']);
  });

  it('still greets an event without a type', () => {
    const result = service.handle([{ id: 'c' }]) as InternalEventAck;

    expect(result.results[0].greeting).toBe(
      'Hello, world from an unlabelled event',
    );
  });

  it('does not treat a validation event without a code as a handshake', () => {
    const result = service.handle([
      {
        id: 'd',
        eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent',
        data: {},
      },
    ]) as InternalEventAck;

    expect(result.message).toBe('Hello, world');
  });
});
