import {
  RequirementSubmission,
  RequirementTextField,
} from '../interfaces/prompt-injection.interface';

/**
 * The Java side has shipped several shapes of the "Post Your Requirements"
 * payload (flat, nested under `requirement`, nested under `payload`), so the
 * parser is key-driven rather than schema-driven: it walks the event data and
 * picks up whatever looks like the phone number and the customer-authored
 * free text. Unknown shapes degrade to a best-effort text sweep instead of
 * dropping the event unscanned.
 */

const PHONE_KEYS = new Set([
  'phone',
  'phoneno',
  'phonenumber',
  'mobile',
  'mobileno',
  'mobilenumber',
  'contact',
  'contactno',
  'contactnumber',
  'customerphone',
  'customermobile',
  'whatsappnumber',
  'msisdn',
  'from',
  'sender',
  'waid',
]);

const NAME_KEYS = new Set([
  'name',
  'customername',
  'fullname',
  'username',
  'contactname',
]);

const REFERENCE_KEYS = new Set([
  'requirementid',
  'postid',
  'leadid',
  'enquiryid',
  'messageid',
  'referenceid',
  'requestid',
  'id',
]);

/** Keys whose values are customer-authored prose and must always be scanned. */
const TEXT_KEYS = new Set([
  'requirement',
  'requirements',
  'requirementtext',
  'requirementdetails',
  'requirementdescription',
  'description',
  'details',
  'message',
  'messagebody',
  'content',
  'body',
  'text',
  'query',
  'question',
  'comment',
  'comments',
  'remarks',
  'notes',
  'additionalinfo',
  'additionaldetails',
  'projectdetails',
  'projectdescription',
  'scope',
  'subject',
  'title',
  'caption',
]);

/** Keys that never carry prose; excluded from the fallback sweep. */
const NON_TEXT_KEYS = new Set([
  'url',
  'imageurl',
  'imageurls',
  'attachmenturl',
  'link',
  'email',
  'emailid',
  'status',
  'type',
  'eventtype',
  'timestamp',
  'createdat',
  'updatedat',
  'city',
  'state',
  'country',
  'pincode',
  'zipcode',
  'currency',
  'source',
  'channel',
  'language',
  'locale',
]);

/** Length above which an unknown string field is swept in as possible prose. */
const FALLBACK_MIN_LENGTH = 16;

const MAX_DEPTH = 5;
const MAX_FIELDS = 20;

const normalizeKey = (key: string): string =>
  key.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Extracts phone, name, reference and every customer-authored text field. */
export function parseRequirementSubmission(
  data: unknown,
): RequirementSubmission {
  const known: RequirementTextField[] = [];
  const fallback: RequirementTextField[] = [];
  const submission: RequirementSubmission = { fields: [] };

  const visit = (node: unknown, path: string, depth: number): void => {
    if (node === null || node === undefined || depth > MAX_DEPTH) {
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item, index) =>
        visit(item, `${path}[${index}]`, depth + 1),
      );
      return;
    }

    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(
        node as Record<string, unknown>,
      )) {
        visit(value, path ? `${path}.${key}` : key, depth + 1);
      }
      return;
    }

    if (typeof node !== 'string' && typeof node !== 'number') {
      return;
    }

    const value = String(node).trim();
    if (!value) {
      return;
    }

    const leaf = path.split('.').pop() ?? path;
    const key = normalizeKey(leaf.replace(/\[\d+\]$/, ''));

    if (!submission.phone && PHONE_KEYS.has(key) && /\d{6,}/.test(value)) {
      submission.phone = value;
      return;
    }
    if (!submission.name && NAME_KEYS.has(key)) {
      submission.name = value;
      // A name is still customer-typed text: an injection can hide in it.
      known.push({ path, value });
      return;
    }
    if (!submission.referenceId && REFERENCE_KEYS.has(key)) {
      submission.referenceId = value;
      return;
    }

    if (TEXT_KEYS.has(key)) {
      known.push({ path, value });
      return;
    }

    if (
      typeof node === 'string' &&
      !NON_TEXT_KEYS.has(key) &&
      !/^https?:\/\//i.test(value) &&
      value.length >= FALLBACK_MIN_LENGTH
    ) {
      fallback.push({ path, value });
    }
  };

  visit(data, '', 0);

  // Known prose keys always win; the sweep only fills in for unknown shapes.
  const fields = known.length > 0 ? known : fallback;
  submission.fields = fields.slice(0, MAX_FIELDS);

  return submission;
}

/**
 * Masks a phone number for logging: keeps the country prefix and the last two
 * digits so an alert can be correlated without writing PII into the log sink.
 */
export function maskPhone(phone?: string): string {
  if (!phone) {
    return 'unknown';
  }
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) {
    return '***';
  }
  const head = digits.slice(0, 2);
  const tail = digits.slice(-2);
  return `${head}${'*'.repeat(Math.max(digits.length - 4, 1))}${tail}`;
}
