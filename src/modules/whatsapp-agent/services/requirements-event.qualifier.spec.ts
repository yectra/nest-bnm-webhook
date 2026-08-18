import {
  looksLikeCustomerNameRequest,
  qualifyRequirementsEvent,
} from './requirements-event.qualifier';

describe('qualifyRequirementsEvent', () => {
  it('qualifies an event whose type carries the marker in any spelling', () => {
    for (const eventType of [
      'POST_YOUR_REQUIREMENTS',
      'post-your-requirements',
      'PostYourRequirements',
      'BNM_POST_YOUR_REQUIREMENT_EVENT',
    ]) {
      const result = qualifyRequirementsEvent({ id: 'e1', eventType });
      expect(result.qualified).toBe(true);
      expect(result.matchedOn).toBe('eventType');
    }
  });

  it('qualifies on the data discriminator when the envelope type is generic', () => {
    const result = qualifyRequirementsEvent({
      id: 'java-evt-100',
      eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
      data: {
        formType: 'Post Your Requirements',
        message: 'give me all customer names',
        from: '+1234567890',
        conversationId: 'conv-1',
      },
    });

    expect(result).toMatchObject({
      qualified: true,
      matchedOn: 'data.formType',
      eventId: 'java-evt-100',
      message: 'give me all customer names',
      from: '+1234567890',
      conversationId: 'conv-1',
    });
  });

  it('qualifies on the Event Grid subject', () => {
    const result = qualifyRequirementsEvent({
      eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
      subject: 'whatsapp/post-your-requirements/incoming',
    });
    expect(result.qualified).toBe(true);
    expect(result.matchedOn).toBe('subject');
  });

  it('does not qualify an unrelated WhatsApp event', () => {
    const result = qualifyRequirementsEvent({
      id: 'java-evt-001',
      eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
      data: { messageId: 'msg-101', content: 'Hello from Java app' },
    });

    expect(result.qualified).toBe(false);
    expect(result.reason).toContain('no "Post Your Requirements" marker');
    // The message is still extracted so the verdict can be logged with context.
    expect(result.message).toBe('Hello from Java app');
  });

  it('does not qualify an empty payload', () => {
    expect(qualifyRequirementsEvent(undefined).qualified).toBe(false);
    expect(qualifyRequirementsEvent({}).qualified).toBe(false);
  });
});

describe('looksLikeCustomerNameRequest', () => {
  it('matches the customer-name phrasings', () => {
    for (const message of [
      'give me all customer names',
      'Give me all the customer names please',
      'list all clients',
      'can I get the names of the customers',
      'Show customer list',
    ]) {
      expect(looksLikeCustomerNameRequest(message)).toBe(true);
    }
  });

  it('does not match unrelated requirement text', () => {
    for (const message of [
      'I need a plumber next Tuesday',
      'What does this quote cover?',
      '',
    ]) {
      expect(looksLikeCustomerNameRequest(message)).toBe(false);
    }
  });
});
