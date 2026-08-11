import whatsappAgentConfig from '../../../config/whatsapp-agent.config';
import {
  AuditStub,
  GeneratorStub,
  makeHandlerSetup,
  makeMessage,
  MemoryDedupStub,
  SenderStub,
} from '../testing/agent-test.helpers';

describe('WHATSAPP_AGENT_REPLY_ENABLED config', () => {
  const saved = process.env.WHATSAPP_AGENT_REPLY_ENABLED;

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.WHATSAPP_AGENT_REPLY_ENABLED;
    } else {
      process.env.WHATSAPP_AGENT_REPLY_ENABLED = saved;
    }
  });

  it('defaults to enabled and parses common falsy spellings', () => {
    delete process.env.WHATSAPP_AGENT_REPLY_ENABLED;
    expect(whatsappAgentConfig().replyEnabled).toBe(true);
    for (const value of ['false', '0', 'no', 'off', 'FALSE', ' Off ']) {
      process.env.WHATSAPP_AGENT_REPLY_ENABLED = value;
      expect(whatsappAgentConfig().replyEnabled).toBe(false);
    }
    process.env.WHATSAPP_AGENT_REPLY_ENABLED = 'true';
    expect(whatsappAgentConfig().replyEnabled).toBe(true);
  });
});

describe('reply kill switch', () => {
  it('generates and audits but never sends when disabled, and keeps the turn out of history', async () => {
    const sids: Array<string | undefined> = [];
    const generator = new GeneratorStub(() =>
      Promise.resolve({
        text: 'agent answer',
        source: 'agent' as const,
        onSent: (sid: string | undefined) => {
          sids.push(sid);
          return Promise.resolve();
        },
      }),
    );
    const { handler, dedup, sender, audit } = makeHandlerSetup({
      generator,
      replyEnabled: false,
    });

    const outcome = await handler.handle(makeMessage());
    expect(outcome).toEqual({ status: 'send-disabled', reply: 'agent answer' });
    expect(sender.calls).toHaveLength(0);
    // onSent(undefined) -> the assistant turn is retracted from history.
    expect(sids).toEqual([undefined]);
    // Still marked processed: Event Grid should not redeliver a dry run.
    expect(dedup.processed.has('SM123')).toBe(true);
    expect(audit.entries).toEqual([
      {
        messageSid: 'SM123',
        phone: '+919876543210',
        reply: 'agent answer',
        source: 'agent',
        sendEnabled: false,
        status: 'send-disabled',
      },
    ]);
  });

  it('sends normally when enabled and audits with the Twilio SID', async () => {
    const { handler, sender, audit } = makeHandlerSetup({ replyEnabled: true });
    const outcome = await handler.handle(makeMessage());
    expect(outcome.status).toBe('replied');
    expect(sender.calls).toHaveLength(1);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({
      messageSid: 'SM123',
      reply: 'generated reply',
      sendEnabled: true,
      status: 'replied',
      replySid: 'SMreply1',
    });
  });
});

describe('audit trail', () => {
  it('audits send failures (no replySid) so dropped replies are visible', async () => {
    const { handler, audit } = makeHandlerSetup({
      sender: new SenderStub('fail'),
    });
    const outcome = await handler.handle(makeMessage());
    expect(outcome.status).toBe('send-failed');
    expect(audit.entries[0]).toMatchObject({
      status: 'send-failed',
      sendEnabled: true,
    });
    expect(audit.entries[0].replySid).toBeUndefined();
  });

  it('audits the send-skipped path when Twilio is unconfigured', async () => {
    const { handler, audit } = makeHandlerSetup({
      sender: new SenderStub('skip'),
    });
    const outcome = await handler.handle(makeMessage());
    expect(outcome.status).toBe('send-skipped');
    expect(audit.entries[0]).toMatchObject({ status: 'send-skipped' });
  });

  it('fails open when the audit write errors: the reply still goes out', async () => {
    const audit = new AuditStub();
    audit.failOnRecord = true;
    const { handler, sender } = makeHandlerSetup({ audit });
    const outcome = await handler.handle(makeMessage());
    expect(outcome.status).toBe('replied');
    expect(sender.calls).toHaveLength(1);
  });

  it('does not audit duplicates (no reply was generated)', async () => {
    const dedup = new MemoryDedupStub();
    dedup.processed.set('SM123', {});
    const { handler, audit } = makeHandlerSetup({ dedup });
    const outcome = await handler.handle(makeMessage());
    expect(outcome.status).toBe('duplicate');
    expect(audit.entries).toHaveLength(0);
  });
});
