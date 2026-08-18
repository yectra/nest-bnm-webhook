import type {
  QualifiableEvent,
  RequirementsQualification,
} from '../interfaces/requirements-event.interface';

/**
 * Canonical marker for the "Post Your Requirements" flow, compared after
 * stripping every non-alphanumeric character. This matches all the spellings
 * the Java publisher and Event Grid subjects use in practice:
 * POST_YOUR_REQUIREMENTS, post-your-requirements, PostYourRequirements,
 * "Post your requirement", ...
 */
const REQUIREMENTS_MARKER = 'postyourrequirement';

/** Envelope fields inspected for the marker, in priority order. */
const ENVELOPE_FIELDS = ['eventType', 'subject', 'topic'] as const;

/** `data` fields inspected for the marker, in priority order. */
const DATA_MARKER_FIELDS = [
  'eventType',
  'type',
  'formType',
  'form',
  'source',
  'sourceType',
  'category',
  'intent',
  'topic',
  'module',
  'page',
  'channel',
  'flow',
  'subject',
  'requestType',
] as const;

/** `data` fields that may carry the customer's free-text message. */
const MESSAGE_FIELDS = [
  'message',
  'messageInfo',
  'messageBody',
  'content',
  'body',
  'Body',
  'text',
  'requirement',
  'requirements',
  'description',
  'query',
  'question',
] as const;

const FROM_FIELDS = ['from', 'From', 'phoneNumber', 'mobile', 'waId'] as const;
const CONVERSATION_FIELDS = [
  'conversationId',
  'sessionId',
  'threadId',
  'messageId',
] as const;
const USER_FIELDS = ['userId', 'customerId', 'user', 'customerName'] as const;

/** Lowercase and drop every non-alphanumeric character. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readString(
  data: Record<string, unknown> | null | undefined,
  keys: readonly string[],
): { key: string; value: string } | undefined {
  if (!data) {
    return undefined;
  }
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) {
      return { key, value: value.trim() };
    }
  }
  return undefined;
}

function carriesMarker(value: unknown): boolean {
  return (
    typeof value === 'string' && normalize(value).includes(REQUIREMENTS_MARKER)
  );
}

/**
 * Decide whether an Event Grid event belongs to the "Post Your Requirements"
 * flow. Pure and synchronous: the Event Grid handler needs the verdict before
 * it acknowledges the delivery, and the branch is taken only on a match.
 *
 * The marker is searched on the envelope (eventType/subject/topic) and on the
 * documented `data` discriminators, so a publisher that keeps the generic
 * `BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT` type and flags the flow inside
 * `data` still qualifies.
 */
export function qualifyRequirementsEvent(
  event: QualifiableEvent | null | undefined,
): RequirementsQualification {
  const data =
    event?.data && typeof event.data === 'object' ? event.data : undefined;

  const base = {
    eventId: event?.id,
    eventType: event?.eventType,
    message: readString(data, MESSAGE_FIELDS)?.value ?? '',
    from: readString(data, FROM_FIELDS)?.value,
    conversationId: readString(data, CONVERSATION_FIELDS)?.value,
    userId: readString(data, USER_FIELDS)?.value,
  };

  if (!event) {
    return { ...base, qualified: false, reason: 'empty event payload' };
  }

  for (const field of ENVELOPE_FIELDS) {
    if (carriesMarker(event[field])) {
      return {
        ...base,
        qualified: true,
        matchedOn: field,
        reason: `"Post Your Requirements" marker found on event.${field}`,
      };
    }
  }

  for (const field of DATA_MARKER_FIELDS) {
    if (carriesMarker(data?.[field])) {
      return {
        ...base,
        qualified: true,
        matchedOn: `data.${field}`,
        reason: `"Post Your Requirements" marker found on event.data.${field}`,
      };
    }
  }

  return {
    ...base,
    qualified: false,
    reason:
      'no "Post Your Requirements" marker on the event envelope or data discriminators',
  };
}

/**
 * Deterministic customer-name intent check, used as the fail-open path when no
 * LLM is configured. With a model the deep agent decides for itself, which is
 * what covers phrasings this regex does not.
 */
const CUSTOMER_NAME_INTENT =
  /\b(customer|client|buyer|lead|requester|user)s?\b[\s\S]{0,40}\b(name|names|list|listing|details)\b|\b(name|names|list)\b[\s\S]{0,40}\b(customer|client|buyer|lead|requester|user)s?\b/i;

export function looksLikeCustomerNameRequest(message: string): boolean {
  return CUSTOMER_NAME_INTENT.test(message ?? '');
}
