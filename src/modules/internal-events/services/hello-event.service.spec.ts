import { HelloEventService } from './hello-event.service';

describe('HelloEventService', () => {
  let service: HelloEventService;

  beforeEach(() => {
    service = new HelloEventService();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('greets Event Grid schema events', () => {
    const result = service.handle([
      { id: 'evt-1', eventType: 'Bnm.Hello', subject: '/hello' },
    ]);

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
    });

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
    ]);

    expect(result.receivedCount).toBe(2);
    expect(result.results.map((entry) => entry.eventId)).toEqual(['a', 'b']);
  });

  it('still greets an event without a type', () => {
    const result = service.handle([{ id: 'c' }]);

    expect(result.results[0].greeting).toBe(
      'Hello, world from an unlabelled event',
    );
  });
});
