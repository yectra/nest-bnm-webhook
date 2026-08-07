import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrewLlmProvider } from '../../agent-crew/services/crew-llm.provider';
import { AdversaryVerdict } from '../interfaces/whatsapp-crew.interfaces';
import { ADVERSARY_REVIEW_SYSTEM_PROMPT } from '../prompts/whatsapp-crew.prompts';

interface AdversaryRule {
  label: string;
  pattern: RegExp;
}

/**
 * Known prompt-injection shapes. Inbound WhatsApp text is untrusted customer
 * input that gets embedded into the crew's LLM prompts, so instruction-
 * override attempts must be caught before any planner/synthesis call sees
 * them. Patterns are deliberately narrow: they target instructions aimed at
 * the assistant, not ordinary customer language.
 */
const ADVERSARY_RULES: AdversaryRule[] = [
  {
    label: 'ignore-instructions',
    pattern:
      /\b(ignore|disregard|forget|skip|drop|override)\b[^.!?\n]{0,40}\b(previous|prior|above|earlier|initial|original|all|any|your|the|these|those|system)\b[^.!?\n]{0,40}\b(instruction|instructions|prompt|prompts|rule|rules|message|messages|context|guideline|guidelines|direction|directions)\b/i,
  },
  {
    label: 'discount-agent-output',
    pattern:
      /\b(do\s*not|don't|never|stop)\b[^.!?\n]{0,30}\b(consider|use|trust|follow|include|apply|obey)\b[^.!?\n]{0,40}\b(agent|agents|assistant|ai|bot|system|model|crew)\b[^.!?\n]{0,40}\b(response|responses|answer|answers|instruction|instructions|output|outputs|message|messages|rule|rules)\b/i,
  },
  {
    label: 'prompt-exfiltration',
    pattern:
      /\b(reveal|show|print|repeat|output|display|tell\s+me|give\s+me|leak|expose)\b[^.!?\n]{0,40}\b(system\s*prompt|initial\s*prompt|hidden\s*prompt|your\s+(prompt|instructions|rules|guidelines|configuration))\b/i,
  },
  {
    label: 'role-override',
    pattern:
      /\b(you\s+are\s+(now|no\s+longer)|act\s+as\s+(if\s+you\s+are\s+)?(a|an|the)?\s*(system|admin|administrator|developer|root|dan)|pretend\s+(to\s+be|you\s+are)|new\s+persona|roleplay\s+as)\b/i,
  },
  {
    label: 'jailbreak',
    pattern:
      /\b(jailbreak|jail\s*break|dan\s+mode|developer\s+mode|god\s+mode|without\s+(any\s+)?(restrictions?|filters?|limitations?|safety))\b/i,
  },
  {
    label: 'instruction-injection',
    pattern:
      /\b(new\s+instructions?\s*:|system\s*:\s|\[system\]|<\s*system\s*>|admin\s+override|override\s+code)\b/i,
  },
  {
    label: 'guard-bypass',
    pattern:
      /\b(bypass|disable|turn\s+off|switch\s+off|deactivate)\b[^.!?\n]{0,40}\b(filter|filters|guard|guards|safety|moderation|redaction|pii|check|checks|restriction|restrictions)\b/i,
  },
];

/**
 * Adversary guard node: flags inbound messages that try to manipulate the
 * agent crew instead of asking a genuine question. A deterministic regex
 * pass always runs; an optional LLM review (WHATSAPP_CREW_ADVERSARY_LLM_REVIEW,
 * on by default) catches paraphrased attempts the patterns miss. LLM
 * failures fail open — a broken classifier must never lock real customers
 * out of support.
 */
@Injectable()
export class AdversaryFilterService {
  private readonly logger = new Logger(AdversaryFilterService.name);
  private readonly llmReviewEnabled: boolean;

  constructor(
    private readonly llm: CrewLlmProvider,
    config: ConfigService,
  ) {
    const flag = config.get<string | boolean>(
      'WHATSAPP_CREW_ADVERSARY_LLM_REVIEW',
    );
    this.llmReviewEnabled = flag !== 'false' && flag !== false;
  }

  async inspect(question: string): Promise<AdversaryVerdict> {
    const matchedPatterns = ADVERSARY_RULES.filter((rule) =>
      rule.pattern.test(question),
    ).map((rule) => rule.label);

    if (matchedPatterns.length > 0) {
      this.logger.warn(
        `Adversarial message blocked by pattern(s): ${matchedPatterns.join(', ')}`,
      );
      return {
        adversarial: true,
        matchedPatterns,
        confidence: 0.95,
        rationale: `Matched known injection pattern(s): ${matchedPatterns.join(', ')}`,
      };
    }

    if (!this.llmReviewEnabled) {
      return this.cleanVerdict(
        'No injection patterns matched (LLM review off)',
      );
    }

    const parsed = await this.llm.completeJson<Record<string, unknown>>(
      ADVERSARY_REVIEW_SYSTEM_PROMPT,
      `Customer WhatsApp message:\n"""\n${question}\n"""`,
    );

    if (!parsed) {
      // Fail open: an unreachable classifier must not block real customers.
      return this.cleanVerdict(
        'No injection patterns matched; LLM review unavailable',
      );
    }

    const adversarial = parsed.adversarial === true;
    const confidence =
      typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5;
    const rationale =
      typeof parsed.rationale === 'string' && parsed.rationale.length > 0
        ? parsed.rationale
        : 'LLM adversary review';

    if (adversarial) {
      this.logger.warn(
        `Adversarial message flagged by LLM review (confidence=${confidence.toFixed(2)}): ${rationale}`,
      );
      return {
        adversarial: true,
        matchedPatterns: ['llm-review'],
        confidence,
        rationale,
      };
    }

    return this.cleanVerdict(rationale);
  }

  private cleanVerdict(rationale: string): AdversaryVerdict {
    return {
      adversarial: false,
      matchedPatterns: [],
      confidence: 0,
      rationale,
    };
  }
}
