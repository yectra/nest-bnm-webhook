import { WhatsappEventHandlerService } from './whatsapp-event-handler.service';
import {
  GeneratorStub,
  makeMessage,
  MemoryDedupStub,
  SenderStub,
} from '../testing/agent-test.helpers';

function makeHandler(
  overrides: {
    dedup?: MemoryDedupStub;
    sender?: SenderStub;
    generator?: GeneratorStub;
  } = {},
) {
  const dedup = overrides.dedup ?? new MemoryDedupStub();
  const sender = overrides.sender ?? new SenderStub('ok');
  const generator =
    overrides.generator ??
    new GeneratorStub(() =>
      Promise.resolve({ text: 'generated reply', source: 'template' }),
    );
  const handler = new WhatsappEventHandlerService(
    dedup.asService(),
    generator.asService(),
    sender.asService(),
  );
  return { handler, dedup, sender, generator };
}

describe('WhatsappEventHandlerService', () => {
  it('replies and records the SID as processed', async () => {
    const { handler, dedup, sender } = makeHandler();
    const outcome = await handler.handle(makeMessage());
    expect(outcome).toEqual({
      status: 'replied',
      replySid: 'SMreply1',
      reply: 'generated reply',
    });
    expect(dedup.processed.has('SM123')).toBe(true);
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0].to).toBe('whatsapp:+919876543210');
  });

  it('skips duplicate messageSids without sending', async () => {
    const dedup = new MemoryDedupStub();
    dedup.processed.set('SM123', {});
    const { handler, sender } = makeHandler({ dedup });
    const outcome = await handler.handle(makeMessage());
    expect(outcome).toEqual({ status: 'duplicate' });
    expect(sender.calls).toHaveLength(0);
  });

  it('answers normally when the dedup store fails open', async () => {
    const dedup = new MemoryDedupStub();
    dedup.failOnCheck = true;
    dedup.processed.set('SM123', {}); // would be a duplicate, but check fails open
    const { handler, sender } = makeHandler({ dedup });
    const outcome = await handler.handle(makeMessage());
    expect(outcome.status).toBe('replied');
    expect(sender.calls).toHaveLength(1);
  });

  it('degrades to a template reply when reply generation throws', async () => {
    const generator = new GeneratorStub(() =>
      Promise.reject(new Error('agent outage')),
    );
    const { handler, sender } = makeHandler({ generator });
    const outcome = await handler.handle(makeMessage({ body: 'hello' }));
    expect(outcome.status).toBe('replied');
    expect(sender.calls[0].body).toContain('Hello');
  });

  it('does not mark the SID processed when the send fails (Event Grid retries)', async () => {
    const sender = new SenderStub('fail');
    const { handler, dedup } = makeHandler({ sender });
    const outcome = await handler.handle(makeMessage());
    expect(outcome.status).toBe('send-failed');
    expect(dedup.processed.has('SM123')).toBe(false);
  });

  it('marks processed but reports send-skipped when Twilio is unconfigured', async () => {
    const sender = new SenderStub('skip');
    const { handler, dedup } = makeHandler({ sender });
    const outcome = await handler.handle(makeMessage());
    expect(outcome.status).toBe('send-skipped');
    expect(dedup.processed.has('SM123')).toBe(true);
  });

  it('reports the send outcome to the reply via onSent', async () => {
    const sids: Array<string | undefined> = [];
    const generator = new GeneratorStub(() =>
      Promise.resolve({
        text: 'reply',
        onSent: (sid: string | undefined) => {
          sids.push(sid);
          return Promise.resolve();
        },
      }),
    );
    const { handler } = makeHandler({ generator });
    await handler.handle(makeMessage());
    expect(sids).toEqual(['SMreply1']);

    const failGenerator = new GeneratorStub(() =>
      Promise.resolve({
        text: 'reply',
        onSent: (sid: string | undefined) => {
          sids.push(sid);
          return Promise.resolve();
        },
      }),
    );
    const failing = makeHandler({
      sender: new SenderStub('fail'),
      generator: failGenerator,
    });
    await failing.handler.handle(makeMessage({ messageSid: 'SM124' }));
    expect(sids).toEqual(['SMreply1', undefined]);
  });

  it('ignores payloads without messageSid or from', async () => {
    const { handler } = makeHandler();
    const outcome = await handler.handle(makeMessage({ messageSid: '' }));
    expect(outcome.status).toBe('ignored');
  });
});
