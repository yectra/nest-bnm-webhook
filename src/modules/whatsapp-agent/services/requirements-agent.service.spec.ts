import { AIMessage } from '@langchain/core/messages';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import {
  NO_ANSWER_REPLY,
  RequirementsAgentService,
} from './requirements-agent.service';
import { FoundryModelService } from './foundry-model.service';
import { LangsmithTraceService } from './langsmith-trace.service';
import { CustomerDirectoryService } from './customer-directory.service';
import type { RequirementsQualification } from '../interfaces/requirements-event.interface';

const NAMES = ['Asha Menon', 'Ravi Kumar'];

function qualification(message: string): RequirementsQualification {
  return {
    qualified: true,
    reason: 'test',
    matchedOn: 'data.formType',
    eventId: 'evt-1',
    eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
    message,
  };
}

function build(options: {
  model?: BaseChatModel;
  names?: string[];
  directoryError?: string;
  tracing?: boolean;
}) {
  const listCustomerNames = jest.fn().mockResolvedValue({
    names: options.directoryError ? [] : (options.names ?? NAMES),
    scanned: 2,
    container: 'PostYourRequirements',
    error: options.directoryError,
  });

  const foundryModelService = {
    isConfigured: () => Boolean(options.model),
    getModelName: () => 'gpt-5-mini',
    createModel: () => options.model,
  } as unknown as FoundryModelService;

  const flush = jest.fn().mockResolvedValue(undefined);
  const traceService = {
    isEnabled: () => Boolean(options.tracing),
    getProject: () => 'bnm-whatsapp-agent',
    startRun: () => ({
      runId: 'run-123',
      project: options.tracing ? 'bnm-whatsapp-agent' : null,
      config: { runId: 'run-123' },
    }),
    flush,
  } as unknown as LangsmithTraceService;

  const service = new RequirementsAgentService(
    foundryModelService,
    { listCustomerNames } as unknown as CustomerDirectoryService,
    traceService,
  );

  return { service, listCustomerNames, flush };
}

/** Fake model that calls the customer-names tool, then answers from its result. */
class ToolCallingFakeModel extends FakeListChatModel {
  turns = 0;
  override bindTools(): any {
    return this;
  }
  override _generate(): Promise<any> {
    this.turns += 1;
    if (this.turns === 1) {
      return Promise.resolve({
        generations: [
          {
            text: '',
            message: new AIMessage({
              content: '',
              tool_calls: [
                { id: 'call-1', name: 'list_customer_names', args: {} },
              ],
            }),
          },
        ],
      });
    }
    const text = `Customers: ${NAMES.join(', ')}`;
    return Promise.resolve({
      generations: [{ text, message: new AIMessage(text) }],
    });
  }
}

describe('RequirementsAgentService', () => {
  it('lets the gpt-5-mini agent call the customer-names tool and answer from it', async () => {
    const { service, listCustomerNames, flush } = build({
      model: new ToolCallingFakeModel({ responses: ['unused'] }),
      tracing: true,
    });

    const result = await service.run(
      qualification('give me all customer names'),
    );

    expect(listCustomerNames).toHaveBeenCalled();
    expect(result.answer).toBe('Customers: Asha Menon, Ravi Kumar');
    expect(result.customerNamesRequested).toBe(true);
    expect(result.customerNames).toEqual(NAMES);
    expect(result.model).toBe('gpt-5-mini');
    expect(result.degraded).toBe(false);
    // The LangSmith run id is what correlates the Azure log with the trace.
    expect(result.traceRunId).toBe('run-123');
    expect(result.traceProject).toBe('bnm-whatsapp-agent');
    expect(flush).toHaveBeenCalled();
  });

  it('answers from Cosmos when no Foundry deployment is configured', async () => {
    const { service, listCustomerNames } = build({});

    const result = await service.run(
      qualification('Give me all the customer names please'),
    );

    expect(listCustomerNames).toHaveBeenCalled();
    expect(result.answer).toContain('Asha Menon');
    expect(result.answer).toContain('Ravi Kumar');
    expect(result.customerNamesRequested).toBe(true);
    expect(result.model).toBeNull();
    expect(result.degraded).toBe(true);
    // A run id exists even untraced, so the log line is still correlatable.
    expect(result.traceRunId).toBe('run-123');
    expect(result.traceProject).toBeNull();
  });

  it('does not read the directory for an ordinary requirement message', async () => {
    const { service, listCustomerNames } = build({});

    const result = await service.run(
      qualification('I need a plumber next Tuesday'),
    );

    expect(listCustomerNames).not.toHaveBeenCalled();
    expect(result.answer).toBe(NO_ANSWER_REPLY);
    expect(result.customerNames).toEqual([]);
  });

  it('falls back to the deterministic answer when the model errors', async () => {
    class BrokenModel extends FakeListChatModel {
      override bindTools(): any {
        return this;
      }
      override _generate(): Promise<never> {
        return Promise.reject(new Error('foundry outage'));
      }
      override _streamResponseChunks(): AsyncGenerator<never> {
        throw new Error('foundry outage');
      }
    }

    const { service } = build({
      model: new BrokenModel({ responses: ['unused'] }),
    });

    const result = await service.run(
      qualification('give me all customer names'),
    );

    expect(result.answer).toContain('Asha Menon');
    expect(result.degraded).toBe(true);
  });

  it('says so honestly when the customer directory is unreachable', async () => {
    const { service } = build({ directoryError: 'cosmos unreachable' });

    const result = await service.run(qualification('list all customers'));

    expect(result.answer).toContain('could not be reached');
    expect(result.customerNames).toEqual([]);
  });
});
