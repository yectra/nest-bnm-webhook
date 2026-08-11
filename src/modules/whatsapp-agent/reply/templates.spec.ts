import { detectIntent, templateReply } from './templates';
import { normalizePhone } from '../types';
import { makeMessage } from '../testing/agent-test.helpers';

describe('template replies (no-LLM mode)', () => {
  it('greets greetings by name', () => {
    const message = makeMessage({ body: 'Hi there' });
    expect(detectIntent(message)).toBe('greeting');
    expect(templateReply(message)).toContain('Hello Kannan');
  });

  it('acknowledges media messages', () => {
    const message = makeMessage({
      messageType: 'IMAGE',
      numMedia: 1,
      body: '',
    });
    expect(detectIntent(message)).toBe('media');
    expect(templateReply(message)).toContain('attachment');
  });

  it('acknowledges location shares', () => {
    const message = makeMessage({
      messageType: 'LOCATION',
      latitude: 13.08,
      longitude: 80.27,
      body: '',
    });
    expect(detectIntent(message)).toBe('location');
  });

  it('echoes button selections', () => {
    const message = makeMessage({
      messageType: 'BUTTON',
      buttonText: 'Track order',
      buttonPayload: 'TRACK',
    });
    expect(templateReply(message)).toContain('"Track order"');
  });

  it('falls back for arbitrary text', () => {
    const message = makeMessage({ body: 'my invoice is wrong' });
    expect(detectIntent(message)).toBe('fallback');
  });
});

describe('normalizePhone', () => {
  it('strips the whatsapp: prefix', () => {
    expect(normalizePhone('whatsapp:+919876543210')).toBe('+919876543210');
    expect(normalizePhone('+919876543210')).toBe('+919876543210');
    expect(normalizePhone(undefined)).toBe('');
  });
});
