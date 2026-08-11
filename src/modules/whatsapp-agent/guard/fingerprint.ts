import { createHash } from 'node:crypto';

export function normalizeForFingerprint(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** id scheme of the AdversarialInputs container: sha256 of normalized text. */
export function fingerprint(text: string): string {
  return createHash('sha256')
    .update(normalizeForFingerprint(text))
    .digest('hex');
}
