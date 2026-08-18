import { WhatsappAgentEventService } from './whatsapp-agent-event.service';
import { AzureLogService } from './azure-log.service';
import { RequirementsAgentService } from './requirements-agent.service';

const AGENT_RESULT = {
  answer: 'Customers: Asha Menon',
  customerNamesRequested: true,
  customerNames: ['Asha Menon'],
  model: 'gpt-5-mini',
  traceRunId: 'run-123',
  traceProject: 'bnm-whatsapp-agent',
  degraded: false,
  durationMs: 12,
};

function build(run = jest.fn().mockResolvedValue(AGENT_RESULT)) {
  const logged = jest.fn();
  const loggedError = jest.fn();

  const service = new WhatsappAgentEventService(
    { run } as unknown as RequirementsAgentService,
    {
      log: logged,
      warn: jest.fn(),
      error: loggedError,
    } as unknown as AzureLogService,
  );

  return { service, logged, loggedError, run };
}

describe('WhatsappAgentEventService', () => {
  it('runs the agent for a Post Your Requirements event and logs the result to Azure', async () => {
    const { service, logged, run } = build();

    const outcome = await service.handleEvent({
      id: 'evt-1',
      eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
      data: {
        formType: 'POST_YOUR_REQUIREMENTS',
        message: 'give me all customer names',
      },
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(outcome.qualified).toBe(true);
    expect(outcome.result).toEqual(AGENT_RESULT);

    expect(logged).toHaveBeenCalledWith(
      'whatsapp-agent.qualification',
      expect.objectContaining({ qualified: true, matchedOn: 'data.formType' }),
    );
    expect(logged).toHaveBeenCalledWith(
      'whatsapp-agent.requirements-result',
      expect.objectContaining({
        eventId: 'evt-1',
        model: 'gpt-5-mini',
        customerNames: ['Asha Menon'],
        langsmithRunId: 'run-123',
        langsmithProject: 'bnm-whatsapp-agent',
        answer: 'Customers: Asha Menon',
      }),
    );
  });

  it('skips the agent and logs the verdict for an unrelated event', async () => {
    const { service, logged, run } = build();

    const outcome = await service.handleEvent({
      id: 'evt-2',
      eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
      data: { content: 'Hello from Java app' },
    });

    expect(run).not.toHaveBeenCalled();
    expect(outcome.qualified).toBe(false);
    expect(logged).toHaveBeenCalledWith(
      'whatsapp-agent.qualification',
      expect.objectContaining({ qualified: false, eventId: 'evt-2' }),
    );
  });

  it('logs an agent failure to Azure instead of throwing at Event Grid', async () => {
    const { service, loggedError } = build(
      jest.fn().mockRejectedValue(new Error('agent exploded')),
    );

    const outcome = await service.handleEvent({
      id: 'evt-3',
      eventType: 'POST_YOUR_REQUIREMENTS',
      data: { message: 'give me all customer names' },
    });

    expect(outcome).toEqual(
      expect.objectContaining({ qualified: true, eventId: 'evt-3' }),
    );
    expect(outcome.result).toBeUndefined();
    expect(loggedError).toHaveBeenCalledWith(
      'whatsapp-agent.requirements-result',
      expect.objectContaining({ failed: true, error: 'agent exploded' }),
    );
  });
});
