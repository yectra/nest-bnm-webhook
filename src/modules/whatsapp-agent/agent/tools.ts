import { tool } from 'langchain';
import { z } from 'zod';
import {
  ContentRecord,
  CustomerDataService,
} from '../services/customer-data.service';
import { parseCreatedDate } from './date-parse';

export const DEFAULT_NOTIFICATION_LIMIT = 5;

/** Order by parsed createdDate (newest first); unparseable dates sort last. */
export function sortByCreatedDateDesc(
  records: ContentRecord[],
): ContentRecord[] {
  return [...records].sort((a, b) => {
    const ta = parseCreatedDate(a.createdDate) ?? Number.NEGATIVE_INFINITY;
    const tb = parseCreatedDate(b.createdDate) ?? Number.NEGATIVE_INFINITY;
    return tb - ta;
  });
}

/**
 * Build the grounding tools for one conversation. Both tools are closed over
 * the verified sender's phone number — the model cannot pass a different
 * number, so results can never leak another customer's data. Every result
 * row carries a "Container/id" source string the agent must cite from.
 */
export function buildAgentTools(
  senderPhone: string,
  dataSource: Pick<CustomerDataService, 'lookupCustomer' | 'recentContent'>,
) {
  const lookupCustomer = tool(
    async () => {
      const records = await dataSource.lookupCustomer(senderPhone);
      if (records.length === 0) {
        return 'No customer record found for this phone number.';
      }
      return JSON.stringify({
        results: records.map((record) => ({
          source: `User/${record.id}`,
          name: record.name,
          role: record.role,
        })),
      });
    },
    {
      name: 'lookupCustomer',
      description:
        "Look up the customer profile (name, role) for the customer you are talking to. Takes no arguments; it is always scoped to this conversation's verified phone number.",
      schema: z.object({}),
    },
  );

  const recentNotifications = tool(
    async (input: { limit?: number }) => {
      const limit = Math.min(
        Math.max(input?.limit ?? DEFAULT_NOTIFICATION_LIMIT, 1),
        DEFAULT_NOTIFICATION_LIMIT,
      );
      const records = await dataSource.recentContent(senderPhone, limit);
      const mostRecent = sortByCreatedDateDesc(records).slice(0, limit);
      if (mostRecent.length === 0) {
        return 'No notifications found for this phone number.';
      }
      return JSON.stringify({
        results: mostRecent.map((record) => ({
          source: `WhatsAppContent/${record.id}`,
          message: record.renderedMessage,
          type: record.type,
          createdDate: record.createdDate,
        })),
      });
    },
    {
      name: 'recentNotifications',
      description:
        "Fetch the most recent WhatsApp notifications previously sent to this customer, newest first. Always scoped to this conversation's verified phone number.",
      schema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(DEFAULT_NOTIFICATION_LIMIT)
          .optional()
          .describe('How many notifications to return (default 5)'),
      }),
    },
  );

  return [lookupCustomer, recentNotifications];
}
