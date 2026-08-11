import { FakeListChatModel } from '@langchain/core/utils/testing';
import { redactPII } from './redact';
import { SupportAgentService } from '../services/support-agent.service';
import { CheckpointerService } from '../services/checkpointer.service';
import { CustomerDataService } from '../services/customer-data.service';
import { WhatsappEventHandlerService } from '../services/whatsapp-event-handler.service';
import {
  GeneratorStub,
  makeMessage,
  MemoryDedupStub,
  SenderStub,
} from '../testing/agent-test.helpers';

const OWN = '+919876543210';

describe('redactPII', () => {
  it('redacts email addresses', () => {
    expect(redactPII('Contact admin@example.com for help', OWN)).toBe(
      'Contact [email removed] for help',
    );
  });

  it('redacts phone numbers that are not the recipient', () => {
    const result = redactPII('Call +1 415 523 8886 or +44 20 7946 0958', OWN);
    expect(result).not.toContain('415');
    expect(result).not.toContain('7946');
    expect(result).toContain('[phone number removed]');
  });

  it('keeps the recipient phone number, international and local form', () => {
    expect(redactPII(`Your registered number is ${OWN}.`, OWN)).toContain(OWN);
    expect(redactPII('We have 9876543210 on file', OWN)).toContain(
      '9876543210',
    );
  });

  it('redacts 11+ digit identifiers', () => {
    const result = redactPII('Account 123456789012345 was updated', OWN);
    expect(result).not.toContain('123456789012345');
    expect(result).toContain('removed]');
  });

  it('keeps short reference numbers', () => {
    expect(redactPII('Your order 48213 shipped', OWN)).toContain('48213');
  });

  it('redacts secret-shaped tokens', () => {
    const result = redactPII(
      'Use sk-abc123XYZ or key_9f8e7d or token_qwerty42 to authenticate',
      OWN,
    );
    expect(result).not.toContain('sk-abc123XYZ');
    expect(result).not.toContain('key_9f8e7d');
    expect(result).not.toContain('token_qwerty42');
    expect(result).toContain('[credential removed]');
  });

  it('is idempotent', () => {
    const once = redactPII(
      `Reach me at foo@bar.com, +1 202 555 0betray1 or ${OWN}`,
      OWN,
    );
    expect(redactPII(once, OWN)).toBe(once);
  });

  it('handles a missing own-phone by redacting every number', () => {
    const result = redactPII('Call +919876543210', undefined);
    expect(result).toBe('Call [phone number removed]');
  });
});

class PassthroughModel extends FakeListChatModel {
  override bindTools(): any {
    return this;
  }
}

class EmptyDataSource {
  lookupCustomer() {
    return Promise.resolve([]);
  }
  recentContent() {
    return Promise.resolve([]);
  }
}

describe('PII filter as afterAgent middleware', () => {
  it('redacts the assistant message before it is returned or checkpointed', async () => {
    const checkpointerService = new CheckpointerService();
    const service = new SupportAgentService(
      new EmptyDataSource() as unknown as CustomerDataService,
      checkpointerService,
    );
    const model = new PassthroughModel({
      responses: [
        'Your number +919876543210 is verified. Another customer at +1 415 523 8886 (admin@example.com) reported this too.',
      ],
    });
    const reply = await service.generateReply(makeMessage(), model);

    expect(reply.text).toContain('+919876543210'); // recipient number kept
    expect(reply.text).not.toContain('415');
    expect(reply.text).not.toContain('admin@example.com');
    expect(reply.text).toContain('[phone number removed]');
    expect(reply.text).toContain('[email removed]');

    // Checkpointed history holds only the redacted assistant text.
    const tuple = await checkpointerService.get().getTuple({
      configurable: { thread_id: '+919876543210' },
    });
    const state = JSON.stringify(tuple?.checkpoint.channel_values ?? {});
    expect(state).not.toContain('admin@example.com');
    expect(state).not.toContain('415 523 8886');
  });
});

describe('handler-level PII pass (refusals and templates too)', () => {
  it('redacts whatever text is about to be sent', async () => {
    const sender = new SenderStub('ok');
    const generator = new GeneratorStub(() =>
      Promise.resolve({
        text: 'Escalated to ops@example.com, ref 123456789012345',
      }),
    );
    const handler = new WhatsappEventHandlerService(
      new MemoryDedupStub().asService(),
      generator.asService(),
      sender.asService(),
    );
    const outcome = await handler.handle(makeMessage());
    expect(outcome.status).toBe('replied');
    expect(sender.calls[0].body).not.toContain('ops@example.com');
    expect(sender.calls[0].body).not.toContain('123456789012345');
  });
});
