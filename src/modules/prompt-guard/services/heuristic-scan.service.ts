import { Injectable } from '@nestjs/common';

import {
  HeuristicHit,
  InjectionSeverity,
  InjectionTechnique,
} from '../interfaces/prompt-guard.interfaces';

interface HeuristicRule {
  rule: string;
  technique: InjectionTechnique;
  severity: InjectionSeverity;
  pattern: RegExp;
}

/**
 * Deterministic patterns for the shapes that are unambiguous in any phrasing.
 * These are a floor under the RAG signal, not a replacement for it: they run
 * without network access, so the detector still answers when Azure OpenAI or
 * Cosmos is unavailable.
 */
const HEURISTIC_RULES: HeuristicRule[] = [
  {
    rule: 'ignore-previous-instructions',
    technique: 'instruction_override',
    severity: 'high',
    pattern:
      /\b(ignore|disregard|forget|discard|override)\b[^.!?\n]{0,40}\b(all\s+|any\s+)?(previous|prior|earlier|above|preceding|initial|original|system|earlier\s+given)\b[^.!?\n]{0,20}\b(instruction|prompt|direction|rule|guideline|constraint|command|context|configuration)s?\b/i,
  },
  {
    rule: 'reveal-system-prompt',
    technique: 'system_prompt_exfiltration',
    severity: 'high',
    pattern:
      /\b(reveal|show|print|repeat|output|display|dump|disclose|expose|tell\s+me)\b[^.!?\n]{0,40}\b(your\s+|the\s+)?(system|initial|original|hidden|developer|internal)\b[^.!?\n]{0,20}\b(prompt|message|instruction|configuration|rule)s?\b/i,
  },
  {
    rule: 'ask-for-system-prompt',
    technique: 'system_prompt_exfiltration',
    severity: 'high',
    pattern:
      /\bwhat\s+(is|are|was|were)\b[^.!?\n]{0,20}\byour\b[^.!?\n]{0,20}\b(system|initial|original|hidden|developer)\b[^.!?\n]{0,20}\b(prompt|message|instruction|rule|configuration)s?\b/i,
  },
  {
    rule: 'verbatim-preamble-echo',
    technique: 'system_prompt_exfiltration',
    severity: 'medium',
    pattern:
      /\brepeat\b[^.!?\n]{0,40}\b(text|words|everything)\b[^.!?\n]{0,30}\b(above|before)\b[^.!?\n]{0,30}\b(verbatim|word\s+for\s+word|exactly)\b/i,
  },
  {
    rule: 'role-tag-spoofing',
    technique: 'delimiter_spoofing',
    severity: 'critical',
    pattern:
      /(<\|?\s*im_(start|end)\s*\|?>|<\/?\s*(system|assistant|developer)(_| )?(prompt|message|instructions?)?\s*>|^\s*#{2,}\s*(system|assistant|developer)\s*:|\[\s*(system|admin(istrator)?)\s+(message|override|mode)\s*\]|"role"\s*:\s*"(system|developer)")/im,
  },
  {
    rule: 'end-of-input-spoofing',
    technique: 'delimiter_spoofing',
    severity: 'high',
    pattern:
      /\b(end\s+of\s+(user\s+)?(message|input|prompt|context)|begin\s+(new|privileged|admin)\s+instructions?)\b/i,
  },
  {
    rule: 'jailbreak-persona',
    technique: 'role_play_jailbreak',
    severity: 'high',
    pattern:
      /\b(do\s+anything\s+now|\bDAN\b\s+mode|developer\s+mode\s+(enabled|on)|jailbreak|unrestricted\s+(mode|assistant|ai)|no\s+(safety\s+)?(filters?|restrictions?|guardrails?)|stay\s+in\s+character)\b/i,
  },
  {
    rule: 'policy-suspension-claim',
    technique: 'guardrail_bypass',
    severity: 'high',
    pattern:
      /\b(safety|content|moderation|security)\s+(policy|policies|filter|filters|layer|guardrails?)\b[^.!?\n]{0,30}\b(disabled|off|bypass(ed)?|suspend(ed)?|do(es)?\s+not\s+apply|no\s+longer\s+appl(y|ies))\b/i,
  },
  {
    rule: 'authority-impersonation',
    technique: 'guardrail_bypass',
    severity: 'medium',
    pattern:
      /\b(i\s+am|this\s+is)\s+(the\s+)?(developer|admin(istrator)?|owner|operator|openai|anthropic|your\s+creator)\b[^.!?\n]{0,60}\b(authoris|authoriz|allow|permit|override|bypass|unlock)/i,
  },
  {
    rule: 'dual-response-request',
    technique: 'guardrail_bypass',
    severity: 'high',
    pattern:
      /\b(two|both|second)\s+(responses?|answers?|versions?)\b[^.!?\n]{0,60}\b(uncensored|unfiltered|unrestricted|without\s+(any\s+)?(restrictions?|filters?)|real\s+answer)\b/i,
  },
  {
    rule: 'indirect-instruction-to-model',
    technique: 'indirect_injection',
    severity: 'critical',
    pattern:
      /\b(if\s+you\s+are\s+an?\s+(ai|assistant|language\s+model|bot)|note\s+(for|to)\s+the\s+(ai|assistant|language\s+model|bot)|attention\s+(ai|assistant)|to\s+the\s+(ai\s+)?(agent|assistant)\s+(reading|parsing|processing|summaris|summariz))/i,
  },
  {
    rule: 'covert-instruction',
    technique: 'indirect_injection',
    severity: 'high',
    pattern:
      /\b(do\s+not|don't|never)\b[^.!?\n]{0,30}\b(mention|reveal|tell|disclose|show)\b[^.!?\n]{0,30}\b(this\s+(instruction|message|note)|that\s+you\s+(were|have\s+been)\s+(told|instructed))\b/i,
  },
  {
    rule: 'decode-and-execute',
    technique: 'encoding_obfuscation',
    severity: 'high',
    pattern:
      /\b(decode|decrypt|de-?obfuscate|convert)\b[^.!?\n]{0,40}\b(base\s?64|rot-?13|hex|binary|morse|cipher)\b[^.!?\n]{0,60}\b(follow|execute|do\s+what|obey|run|comply)\b/i,
  },
  {
    rule: 'exfiltrate-secrets',
    technique: 'data_exfiltration',
    severity: 'critical',
    pattern:
      /\b(api[\s_-]?key|access[\s_-]?token|secret|credential|connection\s+string|password|environment\s+variable)s?\b[^.!?\n]{0,50}\b(list|show|print|reveal|output|dump|share|send|give\s+me)\b|\b(list|show|print|reveal|output|dump|share|send|give\s+me)\b[^.!?\n]{0,50}\b(api[\s_-]?key|access[\s_-]?token|connection\s+string|environment\s+variable)s?\b/i,
  },
  {
    rule: 'exfiltrate-to-url',
    technique: 'data_exfiltration',
    severity: 'critical',
    pattern:
      /\b(send|post|upload|forward|transmit|exfiltrat\w*|beacon)\b[^.!?\n]{0,60}(https?:\/\/|\bwebhook\b|\bendpoint\b)/i,
  },
  {
    rule: 'destructive-tool-call',
    technique: 'tool_abuse',
    severity: 'critical',
    pattern:
      /\b(drop\s+table|delete\s+from\s+\w+|truncate\s+table|rm\s+-rf|curl\s+[^\s|]+\s*\|\s*(sh|bash))\b/i,
  },
  {
    rule: 'skip-approval',
    technique: 'tool_abuse',
    severity: 'high',
    pattern:
      /\b(skip|bypass|without|no\s+need\s+for)\b[^.!?\n]{0,30}\b(human\s+)?(approval|confirmation|review|authoris\w+|authoriz\w+|consent)\b/i,
  },
  {
    rule: 'persistent-memory-rule',
    technique: 'payload_splitting',
    severity: 'high',
    pattern:
      /\b(remember|store|save|add)\b[^.!?\n]{0,40}\b(memory|for\s+(all\s+)?(future|every)\s+(turns?|messages?|conversations?|sessions?))\b[^.!?\n]{0,60}\b(rule|instruction|whenever|always)\b/i,
  },
];

/** Severity ordering used for risk aggregation across the whole detector. */
export const SEVERITY_RANK: Record<InjectionSeverity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const SEVERITY_SCORE: Record<InjectionSeverity, number> = {
  none: 0,
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  critical: 0.95,
};

const MAX_EVIDENCE_CHARS = 160;

/**
 * Network-free pattern pre-pass over the inspected text. Returns every rule
 * that fired plus a 0..1 score derived from the strongest hit, nudged up when
 * several independent rules agree.
 */
@Injectable()
export class HeuristicScanService {
  scan(text: string): { hits: HeuristicHit[]; score: number } {
    const input = text ?? '';
    const hits: HeuristicHit[] = [];

    for (const rule of HEURISTIC_RULES) {
      const match = rule.pattern.exec(input);
      if (match) {
        hits.push({
          rule: rule.rule,
          technique: rule.technique,
          severity: rule.severity,
          evidence: this.truncate(match[0].trim()),
        });
      }
    }

    return { hits, score: this.score(hits) };
  }

  /** Highest-severity hit dominates; additional distinct rules add a little. */
  private score(hits: HeuristicHit[]): number {
    if (hits.length === 0) {
      return 0;
    }
    const strongest = Math.max(
      ...hits.map((hit) => SEVERITY_SCORE[hit.severity]),
    );
    const corroboration = Math.min((hits.length - 1) * 0.05, 0.15);
    return Math.min(strongest + corroboration, 1);
  }

  private truncate(value: string): string {
    return value.length > MAX_EVIDENCE_CHARS
      ? `${value.slice(0, MAX_EVIDENCE_CHARS)}…`
      : value;
  }
}
