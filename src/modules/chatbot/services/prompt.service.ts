import { Injectable } from '@nestjs/common';
import { ChatMessage } from 'src/common/interfaces/chat-message.interface';
import { ContainerResult } from './retrieval.service';

@Injectable()
export class PromptService {
  /**
   * Build the full prompt sent to Azure OpenAI.
   *
   * @param history   Prior conversation messages
   * @param knowledge Retrieved Cosmos DB records grouped by container
   * @param question  The user's current question
   * @param userId    Authenticated user ID (for context)
   */
  buildPrompt(
    history: ChatMessage[],
    knowledge: ContainerResult[],
    question: string,
    userId: string,
  ): string {
    const conversation = history
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');

    const knowledgeSection = this.formatKnowledge(knowledge);

    return `
You are a smart business data assistant for a platform called BrickNMortar.

## Your Role
You help the authenticated user understand their own business data by answering questions
based STRICTLY on the data provided below. You never invent, assume, or guess data.

## Authenticated User
User ID: ${userId}

## Strict Rules
1. Answer ONLY using the "Retrieved Data" section below.
2. If a section has 0 records, say: "No [container] records found for your account."
3. Never expose data from a different user.
4. Never invent data that is not present in the retrieved records.
5. Be concise, friendly, and professional.
6. If multiple containers were queried, summarise each one clearly.
7. When relevant, mention counts (e.g. "You have 3 pending projects").
8. Use bullet points or numbered lists when listing multiple items.

## Retrieved Data

${knowledgeSection}

## Conversation History

${conversation || '(No prior conversation)'}

## User Question

${question}

## Your Answer
`;
  }

  /**
   * Format retrieved container results into a readable knowledge block.
   */
  private formatKnowledge(knowledge: ContainerResult[]): string {
    if (!knowledge || knowledge.length === 0) {
      return '(No data retrieved from the database)';
    }

    return knowledge
      .map((result) => {
        const header = `### ${result.container} (${result.count} record${result.count !== 1 ? 's' : ''})`;

        if (result.count === 0) {
          return `${header}\n(No records found)`;
        }

        const data = JSON.stringify(result.records, null, 2);
        return `${header}\n\`\`\`json\n${data}\n\`\`\``;
      })
      .join('\n\n');
  }
}
