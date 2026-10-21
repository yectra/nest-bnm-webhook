import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SenderPolicyMode } from './token-budget.types';

export interface SenderCheckResult {
  allowed: boolean;
  normalizedSender?: string;
  maskedSender?: string;
  reason?: string;
}

@Injectable()
export class WhatsAppSenderPolicyService {
  private readonly logger = new Logger(WhatsAppSenderPolicyService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Retrieves the configured sender policy mode ('allowlist' | 'all').
   * Defaults to 'allowlist'.
   */
  getSenderMode(): SenderPolicyMode {
    const mode = (
      this.configService.get<string>('AI_TOKEN_BUDGET_SENDER_MODE') ||
      'allowlist'
    ).toLowerCase();
    return mode === 'all' ? 'all' : 'allowlist';
  }

  /**
   * Normalizes any phone number or Twilio/WhatsApp string to standard E.164 format (+[country][national]).
   * e.g. 'whatsapp:+14155552671' -> '+14155552671'
   * e.g. ' +91 98765-43210 ' -> '+919876543210'
   * e.g. '0014155552671' -> '+14155552671'
   */
  normalizePhoneNumber(rawNumber?: string | null): string | null {
    if (!rawNumber || typeof rawNumber !== 'string') {
      return null;
    }

    let cleaned = rawNumber.trim();
    // Remove "whatsapp:" or "tel:" prefix if present
    cleaned = cleaned.replace(/^(whatsapp|tel):/i, '').trim();

    // Remove common formatting characters: spaces, parentheses, hyphens, dots
    cleaned = cleaned.replace(/[\s()\-.]/g, '');

    if (!cleaned) {
      return null;
    }

    // Handle leading 00 (international prefix alternative to +)
    if (cleaned.startsWith('00')) {
      cleaned = '+' + cleaned.substring(2);
    } else if (!cleaned.startsWith('+')) {
      // If it doesn't have a plus, prepend plus
      cleaned = '+' + cleaned;
    }

    // E.164: + followed by 7 to 15 digits
    const e164Regex = /^\+[1-9]\d{6,14}$/;
    if (!e164Regex.test(cleaned)) {
      return null;
    }

    return cleaned;
  }

  /**
   * Masks a phone number for safe structured logging.
   * e.g. '+14155552671' -> '+1415***2671'
   */
  maskPhoneNumber(phoneNumber?: string | null): string {
    if (!phoneNumber) {
      return 'unknown';
    }
    const normalized = this.normalizePhoneNumber(phoneNumber) || phoneNumber;
    if (normalized.length <= 6) {
      return '***';
    }
    const prefix = normalized.substring(0, 5);
    const suffix = normalized.substring(normalized.length - 4);
    return `${prefix}***${suffix}`;
  }

  /**
   * Returns the set of configured, normalized authorized WhatsApp numbers.
   */
  getAllowedNumbers(): Set<string> {
    const rawConfig =
      this.configService.get<string>(
        'AI_TOKEN_BUDGET_ALLOWED_WHATSAPP_NUMBERS',
      ) || '';
    const numbers = rawConfig
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n.length > 0);

    const normalizedSet = new Set<string>();
    for (const num of numbers) {
      const normalized = this.normalizePhoneNumber(num);
      if (normalized) {
        normalizedSet.add(normalized);
      } else {
        this.logger.warn(
          `Configured authorized number "${this.maskPhoneNumber(num)}" could not be normalized to valid E.164 format.`,
        );
      }
    }
    return normalizedSet;
  }

  /**
   * Evaluates whether a sender is allowed according to the configured policy.
   * In 'allowlist' mode:
   *   - If allowlist is empty or invalid: FAILS CLOSED.
   *   - If sender is not in allowlist: REJECTED.
   * In 'all' mode:
   *   - Any valid normalized sender is permitted.
   */
  validateSender(rawSender?: string | null): SenderCheckResult {
    const mode = this.getSenderMode();
    const normalized = this.normalizePhoneNumber(rawSender);
    const masked = this.maskPhoneNumber(rawSender);

    if (!rawSender || !normalized) {
      this.logger.warn(
        `AI_SENDER_NOT_ALLOWED: sender rejected; invalid or missing sender phone number (raw: "${rawSender}").`,
      );
      return {
        allowed: false,
        maskedSender: masked,
        reason: 'Missing or invalid sender phone number format',
      };
    }

    if (mode === 'all') {
      return {
        allowed: true,
        normalizedSender: normalized,
        maskedSender: masked,
      };
    }

    // mode === 'allowlist'
    const allowedSet = this.getAllowedNumbers();

    // FAIL CLOSED if allowlist is empty
    if (allowedSet.size === 0) {
      this.logger.error(
        `AI_SENDER_NOT_ALLOWED: sender rejected; allowlist mode is active but AI_TOKEN_BUDGET_ALLOWED_WHATSAPP_NUMBERS is empty or invalid. Failing closed.`,
      );
      return {
        allowed: false,
        normalizedSender: normalized,
        maskedSender: masked,
        reason: 'Allowlist is empty or invalid (fail-closed)',
      };
    }

    if (!allowedSet.has(normalized)) {
      this.logger.warn(
        `AI_SENDER_NOT_ALLOWED: sender rejected; sender ${masked} not in allowlist; event skipped.`,
      );
      return {
        allowed: false,
        normalizedSender: normalized,
        maskedSender: masked,
        reason: 'Sender not in allowlist',
      };
    }

    return {
      allowed: true,
      normalizedSender: normalized,
      maskedSender: masked,
    };
  }

  /**
   * Helper to extract the original sender number from various Event Grid or Twilio payload structures.
   */
  extractSenderFromPayload(
    payload: Record<string, unknown> | null | undefined,
  ): string | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    // Direct Twilio webhook body: From or sender
    if (typeof payload.From === 'string') {
      return payload.From;
    }
    if (typeof payload.from === 'string') {
      return payload.from;
    }

    // Event Grid structure: event.data
    const data = (
      payload.data && typeof payload.data === 'object' ? payload.data : payload
    ) as Record<string, unknown>;

    const candidates = [
      data.from,
      data.sender,
      data.contact,
      data.phone,
      data.phoneNumber,
      data.mobile,
      data.senderNumber,
      data.wa_id,
      data.From,
    ];

    for (const cand of candidates) {
      if (typeof cand === 'string' && cand.trim().length > 0) {
        return cand.trim();
      }
    }

    // Check nested contact objects: e.g. data.customer.phone
    if (data.customer && typeof data.customer === 'object') {
      const cust = data.customer as Record<string, unknown>;
      const custCand = cust.phone || cust.mobile;
      if (typeof custCand === 'string' && custCand.trim().length > 0) {
        return custCand.trim();
      }
    }

    return null;
  }
}
