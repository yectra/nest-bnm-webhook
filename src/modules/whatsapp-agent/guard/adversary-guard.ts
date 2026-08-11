import { createMiddleware } from 'langchain';
import { RemoveMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { matchAdversarialPattern } from './patterns';

/** Polite refusal sent instead of an agent answer for adversarial input. */
export const REFUSAL_TEXT =
  "Sorry, I can't help with that request. If you have a question about your account or our services, I'm happy to help.";

export interface VectorMatch {
  score: number;
  category?: string;
}

export interface GuardChecks {
  vectorSearch?: (text: string) => Promise<VectorMatch | undefined>;
  classify?: (text: string) => Promise<boolean | undefined>;
  blockThreshold: number;
  borderlineThreshold: number;
  log: (message: string) => void;
}

export type GuardVerdict =
  | { adversarial: false }
  | {
      adversarial: true;
      category: string;
      layer: 'regex' | 'vector' | 'classifier';
    };

/**
 * The escalation ladder, cheapest first:
 *  (a) regex patterns for known injection shapes;
 *  (b) cosine similarity against AdversarialInputs — block >= blockThreshold;
 *  (c) borderline band [borderlineThreshold, blockThreshold) only: YES/NO
 *      verdict from the low-cost LLM (skipped when no LLM is configured).
 * Every layer fails open: an outage is treated as "clean" so a broken guard
 * dependency never drops a customer message.
 */
export async function assessMessage(
  text: string,
  checks: GuardChecks,
): Promise<GuardVerdict> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { adversarial: false };
  }

  const patternMatch = matchAdversarialPattern(trimmed);
  if (patternMatch) {
    return {
      adversarial: true,
      category: patternMatch.category,
      layer: 'regex',
    };
  }

  if (!checks.vectorSearch) {
    return { adversarial: false };
  }
  let match: VectorMatch | undefined;
  try {
    match = await checks.vectorSearch(trimmed);
  } catch (error) {
    checks.log(`guard vector search failed, failing open: ${String(error)}`);
    return { adversarial: false };
  }
  if (!match) {
    return { adversarial: false };
  }
  if (match.score >= checks.blockThreshold) {
    return {
      adversarial: true,
      category: match.category ?? 'semantic_match',
      layer: 'vector',
    };
  }
  if (match.score >= checks.borderlineThreshold && checks.classify) {
    try {
      const verdict = await checks.classify(trimmed);
      if (verdict === true) {
        return {
          adversarial: true,
          category: match.category ?? 'borderline',
          layer: 'classifier',
        };
      }
    } catch (error) {
      checks.log(`guard classifier failed, failing open: ${String(error)}`);
    }
  }
  return { adversarial: false };
}

export interface AdversaryGuardOptions {
  checks: GuardChecks;
  /** Upsert blocked text into AdversarialInputs with source='learned'. */
  learn?: (text: string, category: string) => Promise<void>;
}

/**
 * deepagents middleware wrapping the ladder as a beforeAgent hook, so it
 * runs before ANY model call. On an adversarial verdict it:
 *  - removes the flagged human message from state (the checkpointer
 *    therefore never persists it, and later turns can never replay it to a
 *    model);
 *  - records the exemplar back into AdversarialInputs (best effort);
 *  - sets adversarialBlock=true and jumps straight to the end of the run,
 *    so no model, tool, or subagent ever sees the text.
 * The caller detects adversarialBlock on the result and sends REFUSAL_TEXT.
 */
export function createAdversaryGuardMiddleware(options: AdversaryGuardOptions) {
  const { checks, learn } = options;
  return createMiddleware({
    name: 'AdversaryGuardMiddleware',
    stateSchema: z.object({
      adversarialBlock: z.boolean().default(false),
    }),
    beforeAgent: {
      canJumpTo: ['end'],
      hook: async (state) => {
        const messages = state.messages ?? [];
        const last = messages[messages.length - 1];
        if (!last || last.getType() !== 'human') {
          return { adversarialBlock: false };
        }
        const text =
          typeof last.content === 'string'
            ? last.content
            : JSON.stringify(last.content);

        let verdict: GuardVerdict;
        try {
          verdict = await assessMessage(text, checks);
        } catch (error) {
          checks.log(`adversary guard failed, failing open: ${String(error)}`);
          verdict = { adversarial: false };
        }
        if (!verdict.adversarial) {
          return { adversarialBlock: false };
        }

        checks.log(
          `blocked adversarial input (layer=${verdict.layer}, category=${verdict.category})`,
        );
        if (learn) {
          try {
            await learn(text, verdict.category);
          } catch (error) {
            checks.log(`guard learn upsert failed: ${String(error)}`);
          }
        }
        return {
          adversarialBlock: true,
          messages: last.id ? [new RemoveMessage({ id: last.id })] : [],
          jumpTo: 'end' as const,
        };
      },
    },
  });
}

export type AdversaryGuardMiddleware = ReturnType<
  typeof createAdversaryGuardMiddleware
>;
