/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Injectable, Logger } from '@nestjs/common';
import { AIService } from '../../ai/ai.service';
import { QueryPlan } from '../../../common/interfaces/query-plan.interface';

@Injectable()
export class QueryPlannerService {
  private readonly logger = new Logger(QueryPlannerService.name);

  constructor(private readonly aiService: AIService) {}

  /**
   * Use Azure OpenAI to analyze the user's question and produce a structured
   * QueryPlan that tells the chatbot which Cosmos DB containers to query and
   * what filters to apply.
   */
  async plan(question: string): Promise<QueryPlan> {
    const prompt = `
You are a query planner for a business data assistant.

Your job is to analyze the user's question and return a JSON object that describes what data to fetch from a database.

## Available Containers

| Container    | Description                                                   |
|-------------|---------------------------------------------------------------|
| Category    | Global list of service categories (shared, no user filter)    |
| ContactUs   | Contact messages and inquiry requests submitted by the user   |
| Project     | Projects belonging to the user (status: pending/active/done)  |
| Quote       | Quotations created by the user (status: pending/approved/etc) |
| Service     | Services offered by or for the user                           |
| Vendor      | Vendors/suppliers associated with the user                    |
| AskOurExpert| Expert consultation requests submitted by the user            |

## Response Format

Return ONLY a valid JSON object. No markdown, no explanation:

{
  "containers": ["ContainerName"],
  "operation": "LIST" | "SEARCH" | "SUMMARY",
  "filters": {
    "status": "pending" | "active" | "completed" | "approved" | null,
    "keyword": "search term or null"
  },
  "limit": 50
}

## Rules

- "SUMMARY" operation means query ALL containers (use all 7 in containers array)
- "LIST" means fetch records, optionally filtered by status
- "SEARCH" means filter by a keyword in name/description
- Extract status from words like: pending, active, approved, completed, waiting, unanswered
- If the question is about business overview/summary/dashboard → use SUMMARY with all containers
- Always return valid JSON

## Examples

Question: "Show my pending projects"
Answer: {"containers":["Project"],"operation":"LIST","filters":{"status":"pending"},"limit":50}

Question: "Which quotations are waiting for approval?"
Answer: {"containers":["Quote"],"operation":"LIST","filters":{"status":"pending"},"limit":50}

Question: "List my active vendors"
Answer: {"containers":["Vendor"],"operation":"LIST","filters":{"status":"active"},"limit":50}

Question: "How many services do I have?"
Answer: {"containers":["Service"],"operation":"LIST","filters":{},"limit":100}

Question: "Are there any unanswered contact requests?"
Answer: {"containers":["ContactUs"],"operation":"LIST","filters":{"status":"unanswered"},"limit":50}

Question: "Give me a summary of my business"
Answer: {"containers":["Category","ContactUs","Project","Quote","Service","Vendor","AskOurExpert"],"operation":"SUMMARY","filters":{},"limit":50}

Question: "What categories are available?"
Answer: {"containers":["Category"],"operation":"LIST","filters":{},"limit":100}

Question: "Tell me about Home Theatre"
Answer: {"containers":["Category","Service"],"operation":"SEARCH","filters":{"keyword":"Home Theatre"},"limit":20}

## User Question

${question}
`;

    try {
      const response = await this.aiService.generate(prompt);

      // Strip markdown code fences if present
      const cleaned = response
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/gi, '')
        .trim();

      const parsed = JSON.parse(cleaned) as QueryPlan;

      // Validate and apply defaults
      return {
        containers: Array.isArray(parsed.containers) ? parsed.containers : [],
        operation: parsed.operation ?? 'LIST',
        filters: parsed.filters ?? {},
        limit: parsed.limit ?? 50,
      };
    } catch (error) {
      this.logger.error(
        'QueryPlannerService failed to parse AI response, using fallback plan',
        error,
      );

      // Safe fallback — broad LIST across all user-owned containers
      return {
        containers: [
          'Project',
          'Quote',
          'Service',
          'Vendor',
          'ContactUs',
          'AskOurExpert',
        ],
        operation: 'LIST',
        filters: {},
        limit: 50,
      };
    }
  }
}
