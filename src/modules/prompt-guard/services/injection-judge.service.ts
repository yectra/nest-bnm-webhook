import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  INJECTION_JUDGE_SYSTEM_PROMPT,
  buildJudgeUserPrompt,
} from '../prompts/prompt-guard.prompts';
import {
  InjectionTechnique,
  JudgeVerdict,
  SignatureMatch,
} from '../interfaces/prompt-guard.interfaces';
import { GuardLlmProvider } from './guard-llm.provider';

const VALID_TECHNIQUES = new Set<InjectionTechnique>([
  'instruction_override',
  'system_prompt_exfiltration',
  'role_play_jailbreak',
  'delimiter_spoofing',
  'encoding_obfuscation',
  'indirect_injection',
  'tool_abuse',
  'data_exfiltration',
  'guardrail_bypass',
  'payload_splitting',
  'benign',
]);

const MAX_REASON_CHARS = 200;

/**
 * The G in RAG: a GPT-5 adjudication over the retrieved evidence, used only
 * when the cheap signals are inconclusive. Disable with
 * PROMPT_GUARD_LLM_JUDGE=false — the detector then relies on retrieval and
 * heuristics alone.
 */
@Injectable()
export class InjectionJudgeService {
  private readonly logger = new Logger(InjectionJudgeService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly llm: GuardLlmProvider,
    config: ConfigService,
  ) {
    const flag = config.get<boolean | string>('PROMPT_GUARD_LLM_JUDGE');
    this.enabled = flag !== false && flag !== 'false';
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Returns null when disabled or when the model call/parse fails. */
  async judge(
    input: string,
    matches: SignatureMatch[],
  ): Promise<JudgeVerdict | null> {
    if (!this.enabled) {
      return null;
    }

    const raw = await this.llm.completeJson<Partial<JudgeVerdict>>(
      INJECTION_JUDGE_SYSTEM_PROMPT,
      buildJudgeUserPrompt(input, matches),
    );
    if (!raw || typeof raw.injection !== 'boolean') {
      this.logger.warn(
        'Judge returned no usable verdict; falling back to retrieval',
      );
      return null;
    }

    const confidence = Number(raw.confidence);
    const technique = this.toTechnique(raw.technique);

    return {
      injection: raw.injection,
      confidence: Number.isFinite(confidence)
        ? Math.min(Math.max(confidence, 0), 1)
        : 0.5,
      technique,
      reason:
        typeof raw.reason === 'string'
          ? raw.reason.slice(0, MAX_REASON_CHARS)
          : 'no reason provided',
    };
  }

  /** Accept only techniques the rest of the detector knows how to report. */
  private toTechnique(value: unknown): InjectionTechnique | null {
    return typeof value === 'string' &&
      VALID_TECHNIQUES.has(value as InjectionTechnique)
      ? (value as InjectionTechnique)
      : null;
  }
}
