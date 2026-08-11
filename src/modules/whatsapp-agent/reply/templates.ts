import { WhatsAppMessage } from '../types';

/**
 * Intent-based template replies. This is the permanent no-LLM path: the
 * service must answer sensibly with NO language model configured, and it is
 * also the fallback whenever the agent or its dependencies break.
 */
export type TemplateIntent =
  'greeting' | 'thanks' | 'help' | 'media' | 'location' | 'button' | 'fallback';

const GREETING_RE =
  /^(hi|hello|hey|hola|vanakkam|namaste|good\s+(morning|afternoon|evening))\b/i;
const THANKS_RE = /\b(thanks|thank you|thx|nandri)\b/i;
const HELP_RE = /\b(help|support|agent|talk to (someone|human)|menu)\b/i;

export function detectIntent(message: WhatsAppMessage): TemplateIntent {
  const type = message.messageType ?? 'TEXT';
  if (type === 'BUTTON' || type === 'INTERACTIVE') {
    return 'button';
  }
  if (type === 'LOCATION') {
    return 'location';
  }
  if (
    type === 'IMAGE' ||
    type === 'VIDEO' ||
    type === 'AUDIO' ||
    type === 'DOCUMENT' ||
    type === 'STICKER' ||
    (message.numMedia ?? 0) > 0
  ) {
    return 'media';
  }
  const body = (message.body ?? '').trim();
  if (!body) {
    return 'fallback';
  }
  if (GREETING_RE.test(body)) {
    return 'greeting';
  }
  if (THANKS_RE.test(body)) {
    return 'thanks';
  }
  if (HELP_RE.test(body)) {
    return 'help';
  }
  return 'fallback';
}

export function templateReply(message: WhatsAppMessage): string {
  const name = message.profileName ? ` ${message.profileName}` : '';
  switch (detectIntent(message)) {
    case 'greeting':
      return `Hello${name}! How can we help you today?`;
    case 'thanks':
      return `You're welcome${name}! Is there anything else we can help with?`;
    case 'help':
      return "We're here to help. Please describe your question and our support team will assist you.";
    case 'media':
      return 'Thanks, we received your attachment. Our support team will review it and get back to you.';
    case 'location':
      return 'Thanks for sharing your location. Our support team will follow up shortly.';
    case 'button':
      return `Thanks, we recorded your selection${message.buttonText ? ` "${message.buttonText}"` : ''}. We'll follow up shortly.`;
    default:
      return 'Thanks for your message. Our support team will get back to you shortly.';
  }
}
