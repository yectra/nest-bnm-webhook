import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrewLlmProvider } from './crew-llm.provider';
import { PiiRedactionResult } from '../interfaces/crew.interfaces';

interface PiiRule {
  label: string;
  pattern: RegExp;
  replacement: string;
}

const PII_RULES: PiiRule[] = [
  {
    label: 'email',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replacement: '[REDACTED EMAIL]',
  },
  {
    // Payment card numbers: 13-19 digits allowing space/dash separators.
    // Runs before the national-id rule so 16-digit cards are not split.
    label: 'card number',
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    replacement: '[REDACTED CARD]',
  },
  {
    // Aadhaar-style 12-digit national ID, grouped 4-4-4. Runs before the
    // generic phone rule so the grouped form is labeled correctly.
    label: 'national id',
    pattern: /\b\d{4}[ -]\d{4}[ -]\d{4}\b(?![ -]?\d)/g,
    replacement: '[REDACTED ID]',
  },
  {
    // Phone numbers: optional +country code, 8-13 digits with common separators.
    label: 'phone number',
    pattern: /(?:(?<=\s)|^|(?<=[:(]))\+?\d[\d ()-]{7,14}\d\b/gm,
    replacement: '[REDACTED PHONE]',
  },
  {
    // Indian PAN: 5 letters, 4 digits, 1 letter.
    label: 'tax id',
    pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    replacement: '[REDACTED ID]',
  },
  {
    // US SSN.
    label: 'ssn',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[REDACTED ID]',
  },
];

const PII_REVIEW_SYSTEM_PROMPT = `You are a strict PII redaction reviewer.
Rewrite the given text replacing ANY remaining personal information (names of private individuals
with contact context, emails, phone numbers, street addresses, government/payment ID numbers)
with bracketed placeholders like [REDACTED PHONE]. Keep everything else EXACTLY as-is,
including formatting. If nothing needs redaction, return the text unchanged.
Return only the rewritten text with no commentary.`;

/**
 * PII guardrail node: a deterministic regex pass always runs; an optional
 * GPT-5 review pass catches free-form PII (addresses, names in contact
 * context) and can be disabled with AGENT_CREW_PII_LLM_REVIEW=false.
 */
@Injectable()
export class PiiFilterService {
  private readonly logger = new Logger(PiiFilterService.name);
  private readonly llmReviewEnabled: boolean;

  constructor(
    private readonly llm: CrewLlmProvider,
    config: ConfigService,
  ) {
    this.llmReviewEnabled =
      config.get<boolean | string>('AGENT_CREW_PII_LLM_REVIEW') !== false &&
      config.get<boolean | string>('AGENT_CREW_PII_LLM_REVIEW') !== 'false';
  }

  /** Deterministic regex-based redaction. Safe to call without network access. */
  redact(text: string): PiiRedactionResult {
    let sanitized = text;
    const redactions: string[] = [];

    for (const rule of PII_RULES) {
      const matches = sanitized.match(rule.pattern);
      if (matches && matches.length > 0) {
        redactions.push(`${rule.label} (${matches.length})`);
        sanitized = sanitized.replace(rule.pattern, rule.replacement);
      }
    }

    return { text: sanitized, redactions };
  }

  /** Full pipeline: regex pass, then optional GPT-5 review pass. */
  async filter(text: string): Promise<PiiRedactionResult> {
    const regexResult = this.redact(text);

    if (!this.llmReviewEnabled) {
      return regexResult;
    }

    try {
      const reviewed = await this.llm.complete(
        PII_REVIEW_SYSTEM_PROMPT,
        regexResult.text,
      );
      if (!reviewed) {
        return regexResult;
      }
      const redactions = [...regexResult.redactions];
      if (reviewed !== regexResult.text) {
        redactions.push('llm review pass');
      }
      return { text: reviewed, redactions };
    } catch (error) {
      this.logger.warn(
        'GPT-5 PII review pass failed, keeping regex-redacted text',
        error,
      );
      return regexResult;
    }
  }
}
