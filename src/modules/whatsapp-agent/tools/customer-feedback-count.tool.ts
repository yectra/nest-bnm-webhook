import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { CustomerFeedbackService } from '../services/customer-feedback.service';

export const CUSTOMER_FEEDBACK_COUNT_TOOL = 'get_customer_feedback_count';

/** Tool output when Cosmos is unreachable — the agent must still answer. */
export const FEEDBACK_COUNT_UNAVAILABLE =
  'The customer feedback count is currently unavailable.';

/**
 * Deep-agent tool that returns the number of items in the customer feedback
 * Cosmos container. Fails open: a Cosmos error becomes a plain "unavailable"
 * message instead of an exception, so the greeting still goes out.
 */
export function buildCustomerFeedbackCountTool(
  feedbackService: CustomerFeedbackService,
) {
  return tool(
    async () => {
      try {
        const count = await feedbackService.countFeedbackItems();
        return `There are ${count} customer feedback items in the database.`;
      } catch {
        return FEEDBACK_COUNT_UNAVAILABLE;
      }
    },
    {
      name: CUSTOMER_FEEDBACK_COUNT_TOOL,
      description:
        'Get the current number of customer feedback items stored in the ' +
        'Cosmos DB customer feedback container. Takes no arguments.',
      schema: z.object({}),
    },
  );
}
