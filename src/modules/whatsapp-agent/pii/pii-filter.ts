import { createMiddleware } from 'langchain';
import { AIMessage } from '@langchain/core/messages';
import { redactPII } from './redact';

/**
 * PII output filter as afterAgent middleware — the last middleware in the
 * stack, so it sees the final assistant message of every completed run. The
 * redacted text replaces the original in state (same message id), so the
 * checkpointed history also only ever holds the redacted version.
 *
 * Defense in depth: the event handler applies the same pure redactPII
 * function to whatever text it is about to send (agent answers, refusals,
 * and template replies alike), so paths that bypass the agent are covered
 * too; the function is idempotent, so the double pass is harmless.
 */
export function createPiiFilterMiddleware(ownPhone: string) {
  return createMiddleware({
    name: 'PiiFilterMiddleware',
    afterAgent: {
      hook: (state) => {
        const messages = state.messages ?? [];
        const last = messages[messages.length - 1];
        if (
          !last ||
          last.getType() !== 'ai' ||
          typeof last.content !== 'string'
        ) {
          return;
        }
        const redacted = redactPII(last.content, ownPhone);
        if (redacted === last.content) {
          return;
        }
        return {
          messages: [
            new AIMessage({
              id: last.id,
              content: redacted,
              additional_kwargs: last.additional_kwargs,
              response_metadata: last.response_metadata,
            }),
          ],
        };
      },
    },
  });
}
