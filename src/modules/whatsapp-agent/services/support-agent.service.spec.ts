import { FakeListChatModel } from '@langchain/core/utils/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describeMessage, SupportAgentService } from './support-agent.service';
import { parseCreatedDate } from '../agent/date-parse';
import { buildAgentTools, sortByCreatedDateDesc } from '../agent/tools';
import {
  ContentRecord,
  CustomerRecord,
  phoneVariants,
} from './customer-data.service';
import { CheckpointerService } from './checkpointer.service';
import { CustomerDataService } from './customer-data.service';
import { makeMessage } from '../testing/agent-test.helpers';

/** Fake model whose bound copy shares response state with the base instance. */
class ScriptedModel extends FakeListChatModel {
  override bindTools(): any {
    return this;
  }
}

class FakeDataSource {
  customerCalls: string[] = [];
  contentCalls: string[] = [];
  customers: CustomerRecord[] = [
    {
      id: 'u1',
      phoneNumber: '+919876543210',
      name: 'Kannan',
      role: 'customer',
    },
  ];
  content: ContentRecord[] = [];

  lookupCustomer(phone: string): Promise<CustomerRecord[]> {
    this.customerCalls.push(phone);
    return Promise.resolve(this.customers);
  }

  recentContent(phone: string): Promise<ContentRecord[]> {
    this.contentCalls.push(phone);
    return Promise.resolve(this.content);
  }
}

function makeService(dataSource: FakeDataSource) {
  const checkpointerService = new CheckpointerService();
  const service = new SupportAgentService(
    dataSource as unknown as CustomerDataService,
    checkpointerService,
  );
  return { service, checkpointerService };
}

describe('createdDate parsing', () => {
  it('parses dd-MMM-yyyy HH:mm', () => {
    expect(parseCreatedDate('05-Aug-2025 14:30')).toBe(
      Date.UTC(2025, 7, 5, 14, 30),
    );
    expect(parseCreatedDate('bogus')).toBeUndefined();
    expect(parseCreatedDate(undefined)).toBeUndefined();
  });

  it('orders by timestamp where string ordering would be wrong', () => {
    const records: ContentRecord[] = [
      { id: 'a', createdDate: '05-Aug-2025 09:00' },
      { id: 'b', createdDate: '28-Jul-2025 09:00' },
      { id: 'c', createdDate: '01-Jan-2026 00:01' },
      { id: 'd', createdDate: 'not-a-date' },
    ];
    // Lexically "05-Aug-2025" < "28-Jul-2025", but Aug is more recent.
    expect(sortByCreatedDateDesc(records).map((r) => r.id)).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
  });
});

describe('agent tools', () => {
  it('scopes both tools to the sender phone and cites Container/id sources', async () => {
    const dataSource = new FakeDataSource();
    dataSource.content = [
      {
        id: 'n1',
        renderedMessage: 'Your order shipped',
        type: 'ORDER',
        createdDate: '05-Aug-2025 14:30',
      },
    ];
    const [lookupCustomer, recentNotifications] = buildAgentTools(
      '+919876543210',
      dataSource,
    );

    // Model-supplied arguments cannot change the phone: schemas expose no
    // phone field, and the data source only ever receives the sender.
    const profile = (await lookupCustomer.invoke({
      phone: '+15550000000',
    })) as string;
    const notifications = (await recentNotifications.invoke({
      limit: 3,
    })) as string;

    expect(dataSource.customerCalls).toEqual(['+919876543210']);
    expect(dataSource.contentCalls).toEqual(['+919876543210']);
    expect(profile).toContain('User/u1');
    expect(profile).toContain('Kannan');
    expect(notifications).toContain('WhatsAppContent/n1');
    expect(notifications).toContain('Your order shipped');
  });

  it('returns explicit empty-result messages instead of inventing data', async () => {
    const dataSource = new FakeDataSource();
    dataSource.customers = [];
    const [lookupCustomer, recentNotifications] = buildAgentTools(
      '+911111111111',
      dataSource,
    );
    expect((await lookupCustomer.invoke({})) as string).toContain(
      'No customer record',
    );
    expect((await recentNotifications.invoke({})) as string).toContain(
      'No notifications',
    );
  });

  it('derives phone variants only from the sender number', () => {
    expect(phoneVariants('+919876543210')).toEqual([
      '+919876543210',
      '919876543210',
      'whatsapp:+919876543210',
    ]);
  });
});

describe('SupportAgentService', () => {
  it('answers and persists the turn under the phone-number thread', async () => {
    const { service, checkpointerService } = makeService(new FakeDataSource());
    const model = new ScriptedModel({
      responses: ['Here is your answer.', 'Second answer.'],
    });

    const first = await service.generateReply(makeMessage(), model);
    expect(first.text).toBe('Here is your answer.');
    expect(first.source).toBe('agent');
    await first.onSent?.('SMreply1'); // delivered -> keep history

    const second = await service.generateReply(
      makeMessage({ messageSid: 'SM124', body: 'and my name?' }),
      model,
    );
    expect(second.text).toBe('Second answer.');

    const tuple = await checkpointerService.get().getTuple({
      configurable: { thread_id: '+919876543210' },
    });
    const state = JSON.stringify(tuple?.checkpoint.channel_values ?? {});
    expect(state).toContain('Here is your answer.');
    expect(state).toContain('Second answer.');
  });

  it('retracts the assistant turn from history when the send returned no SID', async () => {
    const { service, checkpointerService } = makeService(new FakeDataSource());
    const model = new ScriptedModel({
      responses: ['Undelivered reply.', 'Fresh reply.'],
    });

    const first = await service.generateReply(makeMessage(), model);
    expect(first.text).toBe('Undelivered reply.');
    await first.onSent?.(undefined); // send failed -> retract

    const tuple = await checkpointerService.get().getTuple({
      configurable: { thread_id: '+919876543210' },
    });
    const state = JSON.stringify(tuple?.checkpoint.channel_values ?? {});
    expect(state).not.toContain('Undelivered reply.');
    // The customer's own message stays: it was received even if our reply wasn't.
    expect(state).toContain('hello');
  });

  it('swaps checkpointers through CheckpointerService', async () => {
    const checkpointerService = new CheckpointerService();
    const replacement = new MemorySaver();
    checkpointerService.set(replacement);
    expect(checkpointerService.get()).toBe(replacement);
    await Promise.resolve();
  });

  it('describes non-text messages as data for the agent', () => {
    expect(
      describeMessage(
        makeMessage({
          messageType: 'LOCATION',
          latitude: 13.08,
          longitude: 80.27,
          address: 'Chennai',
          body: '',
        }),
      ),
    ).toContain('shared location: Chennai');
    expect(
      describeMessage(
        makeMessage({
          messageType: 'IMAGE',
          numMedia: 1,
          media: [{ contentType: 'image/jpeg' }],
          body: 'invoice attached',
        }),
      ),
    ).toContain('image/jpeg');
  });
});
