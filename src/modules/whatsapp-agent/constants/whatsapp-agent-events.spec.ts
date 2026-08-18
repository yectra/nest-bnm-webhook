import {
  qualifyWhatsappAgentEvent,
  WhatsappAgentEventKind,
  WHATSAPP_AGENT_EVENT_TYPES,
} from './whatsapp-agent-events';

describe('qualifyWhatsappAgentEvent', () => {
  it('qualifies the canonical RAG update event type', () => {
    expect(
      qualifyWhatsappAgentEvent({
        eventType: WHATSAPP_AGENT_EVENT_TYPES.UPDATE_PROMPT_INJECTION_RAG,
      }),
    ).toBe(WhatsappAgentEventKind.UpdatePromptInjectionRag);
  });

  it.each([
    'UPDATE_PROMPT_INJECTION_RAG',
    'update-prompt-injection-rag',
    'Update Prompt Injection RAG',
    'BNM.WhatsApp.UpdatePromptInjectionRag',
  ])('qualifies the producer spelling %s', (eventType) => {
    expect(qualifyWhatsappAgentEvent({ eventType })).toBe(
      WhatsappAgentEventKind.UpdatePromptInjectionRag,
    );
  });

  it('qualifies the event when the name is on the subject', () => {
    expect(
      qualifyWhatsappAgentEvent({
        eventType: 'BNM_GENERIC_EVENT',
        subject: 'whatsapp/agent/update-prompt-injection-rag',
      }),
    ).toBe(WhatsappAgentEventKind.UpdatePromptInjectionRag);
  });

  it('qualifies the event when the name is inside data', () => {
    expect(
      qualifyWhatsappAgentEvent({
        eventType: 'BNM_GENERIC_EVENT',
        data: { action: 'UPDATE_PROMPT_INJECTION_RAG' },
      }),
    ).toBe(WhatsappAgentEventKind.UpdatePromptInjectionRag);
  });

  it('qualifies the inbound WhatsApp message event', () => {
    expect(
      qualifyWhatsappAgentEvent({
        eventType: WHATSAPP_AGENT_EVENT_TYPES.MESSAGE_RECEIVED,
      }),
    ).toBe(WhatsappAgentEventKind.MessageReceived);
  });

  it('does not qualify unrelated or partially matching events', () => {
    expect(qualifyWhatsappAgentEvent({ eventType: 'SOME_OTHER_EVENT' })).toBe(
      WhatsappAgentEventKind.Unknown,
    );
    // "prompt injection" alone is not an instruction to rebuild the RAG.
    expect(
      qualifyWhatsappAgentEvent({ eventType: 'PROMPT_INJECTION_DETECTED' }),
    ).toBe(WhatsappAgentEventKind.Unknown);
    expect(qualifyWhatsappAgentEvent({})).toBe(WhatsappAgentEventKind.Unknown);
  });
});
