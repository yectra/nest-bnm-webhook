/**
 * Deterministic PII redaction for outbound replies. Pure and idempotent, so
 * it can run both inside the agent (afterAgent middleware) and again in the
 * event handler just before the Twilio send — the second pass is a no-op.
 *
 * Redacts:
 *  - email addresses
 *  - phone numbers other than the recipient's own (the customer may always
 *    see their own number)
 *  - identifiers of 11+ consecutive digits
 *  - secret-shaped tokens (sk-/key_/token_ prefixes)
 */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SECRET_RE = /\b(?:sk-|key_|token_)[A-Za-z0-9_-]{4,}/g;
const PHONE_RE = /\+?\d(?:[\d\s().-]{5,}\d|\d{5,})/g;
const LONG_ID_RE = /\d{11,}/g;

const EMAIL_MASK = '[email removed]';
const PHONE_MASK = '[phone number removed]';
const ID_MASK = '[identifier removed]';
const SECRET_MASK = '[credential removed]';

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/** Does this digit run belong to the recipient's own number? */
function isOwnNumber(candidateDigits: string, ownDigits: string): boolean {
  if (!ownDigits || candidateDigits.length < 7) {
    return false;
  }
  return (
    candidateDigits === ownDigits ||
    ownDigits.endsWith(candidateDigits) ||
    candidateDigits.endsWith(ownDigits)
  );
}

function matchLooksLikePhone(match: string): boolean {
  return /[\s().+-]/.test(match.trim());
}

export function redactPII(text: string, ownPhone: string | undefined): string {
  const ownDigits = digitsOf(ownPhone ?? '');

  let result = text.replace(EMAIL_RE, EMAIL_MASK);
  result = result.replace(SECRET_RE, SECRET_MASK);
  result = result.replace(PHONE_RE, (match) => {
    const candidate = digitsOf(match);
    if (candidate.length < 7) {
      return match; // too short to be a phone number (e.g. an order id)
    }
    if (isOwnNumber(candidate, ownDigits)) {
      return match;
    }
    return candidate.length >= 11 && !match.trim().startsWith('+')
      ? // an unformatted 11+ digit run reads as an identifier, not a phone
        matchLooksLikePhone(match)
        ? PHONE_MASK
        : ID_MASK
      : PHONE_MASK;
  });
  result = result.replace(LONG_ID_RE, (match) =>
    isOwnNumber(match, ownDigits) ? match : ID_MASK,
  );
  return result;
}
