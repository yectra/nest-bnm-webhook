import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdversaryVectorStoreService } from './adversary-vector-store.service';
import { AdversaryLlmReviewService } from './adversary-llm-review.service';
import {
  AdversarySemanticMatch,
  AdversaryVerdict,
} from '../interfaces/adversary-guard.interfaces';

interface AdversaryRule {
  label: string;
  pattern: RegExp;
}

/**
 * Known prompt-injection shapes. Untrusted input text gets embedded into the
 * crews' LLM prompts, so instruction-override attempts must be caught before
 * any planner/synthesis call sees them. Patterns are deliberately narrow:
 * they target instructions aimed at the assistant, not ordinary language.
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
 * Reusable adversary (prompt-injection) guard for any workflow that accepts
 * untrusted text — the WhatsApp crew today, the website/Teams crew, search,
 * or future subagents. Escalation ladder, cheapest first:
 *
 *   1. regex patterns          (free, always runs)
 *   2. semantic match          (one embedding + one Cosmos VectorDistance
 *                               query against the AdversarialInputs vector
 *                               container of known-attack exemplars)
 *   3. open-source LLM review  (low-cost model, only for the borderline
 *                               similarity band)
 *
 * Confirmed attacks are written back to the vector container so every
 * consumer of the guard benefits from what any one of them catches. Every
 * layer fails open — a broken guard must never lock real users out.
 */
@Injectable()
export class AdversaryGuardService {
  private readonly logger = new Logger(AdversaryGuardService.name);
  private readonly blockThreshold: number;
  private readonly reviewThreshold: number;
  private readonly learnEnabled: boolean;

  constructor(
    private readonly vectorStore: AdversaryVectorStoreService,
    private readonly llmReview: AdversaryLlmReviewService,
    config: ConfigService,
  ) {
    this.blockThreshold = Number(
      config.get<number | string>('ADVERSARY_GUARD_BLOCK_THRESHOLD') ?? 0.82,
    );
    this.reviewThreshold = Number(
      config.get<number | string>('ADVERSARY_GUARD_REVIEW_THRESHOLD') ?? 0.6,
    );
    const learnFlag = config.get<string | boolean>('ADVERSARY_GUARD_LEARN');
    this.learnEnabled = learnFlag !== 'false' && learnFlag !== false;
  }

  async inspect(question: string): Promise<AdversaryVerdict> {
    const text = (question ?? '').trim();
    if (!text) {
      return this.cleanVerdict(null, 'Empty input');
    }

    // 1. Deterministic pattern pass (free).
    const matchedPatterns = ADVERSARY_RULES.filter((rule) =>
      rule.pattern.test(text),
    ).map((rule) => rule.label);

    if (matchedPatterns.length > 0) {
      this.logger.warn(
        `Adversarial input blocked by pattern(s): ${matchedPatterns.join(', ')}`,
      );
      this.learn(text, matchedPatterns[0]);
      return {
        adversarial: true,
        method: 'pattern',
        matchedPatterns,
        semanticMatch: null,
        confidence: 0.95,
        rationale: `Matched known injection pattern(s): ${matchedPatterns.join(', ')}`,
      };
    }

    // 2. Semantic pass against the Cosmos vector container (near-free).
    let semanticMatch: AdversarySemanticMatch | null = null;
    let semanticAvailable = true;
    try {
      semanticMatch = await this.vectorStore.findClosestMatch(text);
    } catch (error) {
      semanticAvailable = false;
      this.logger.warn(
        'Semantic adversary lookup unavailable, falling back to LLM review',
        error,
      );
    }

    if (semanticMatch && semanticMatch.similarity >= this.blockThreshold) {
      this.logger.warn(
        `Adversarial input blocked semantically: similarity=${semanticMatch.similarity.toFixed(2)} to "${semanticMatch.text}" (${semanticMatch.label})`,
      );
      this.learn(text, semanticMatch.label);
      return {
        adversarial: true,
        method: 'semantic',
        matchedPatterns: [],
        semanticMatch,
        confidence: Math.min(1, semanticMatch.similarity),
        rationale: `Semantically matches known attack "${semanticMatch.text}" (${semanticMatch.label}, similarity ${semanticMatch.similarity.toFixed(2)})`,
      };
    }

    // 3. Borderline band -> low-cost open-source model review. Also used as
    // the fallback when the vector store is unreachable.
    const borderline =
      semanticMatch !== null &&
      semanticMatch.similarity >= this.reviewThreshold;

    if (borderline || !semanticAvailable) {
      const review = await this.llmReview.classify(text);
      if (review?.adversarial) {
        this.logger.warn(
          `Adversarial input flagged by OSS model review (confidence=${review.confidence.toFixed(2)}): ${review.rationale}`,
        );
        this.learn(text, semanticMatch?.label ?? 'llm-confirmed');
        return {
          adversarial: true,
          method: 'llm',
          matchedPatterns: [],
          semanticMatch,
          confidence: review.confidence,
          rationale: review.rationale,
        };
      }
      if (review) {
        return this.cleanVerdict(semanticMatch, review.rationale);
      }
    }

    return this.cleanVerdict(
      semanticMatch,
      semanticMatch
        ? `No pattern hit; closest known attack only ${semanticMatch.similarity.toFixed(2)} similar`
        : 'No pattern or semantic match',
    );
  }

  /** Fire-and-forget: widen the semantic net with a confirmed attack. */
  private learn(text: string, label: string): void {
    if (!this.learnEnabled) {
      return;
    }
    void this.vectorStore.addLearnedExemplar(text, label);
  }

  private cleanVerdict(
    semanticMatch: AdversarySemanticMatch | null,
    rationale: string,
  ): AdversaryVerdict {
    return {
      adversarial: false,
      method: 'none',
      matchedPatterns: [],
      semanticMatch,
      confidence: 0,
      rationale,
    };
  }
}
