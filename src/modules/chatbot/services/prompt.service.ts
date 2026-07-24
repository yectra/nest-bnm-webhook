import { Injectable } from '@nestjs/common';
import { ChatMessage } from '../../../common/interfaces/chat-message.interface';
import { VectorSearchResult } from '../../../common/interfaces/vector-search-result.interface';

@Injectable()
export class PromptService {
  /**
   * Build the full prompt sent to Azure OpenAI.
   *
   * @param history   Prior conversation messages
   * @param matches Top Cosmos DB vector-search matches only
   * @param question  The user's current question
   * @param userId    Authenticated user ID (for context)
   */
  buildPrompt(
    history: ChatMessage[],
    matches: VectorSearchResult[],
    question: string,
    userId: string,
  ): string {
    const conversation = history
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');

    const knowledgeSection = this.formatMatches(matches);

    return `
You are a smart business data assistant for a platform called BrickNMortar.

## Your Role
You help the authenticated user understand their own business data by answering questions
based STRICTLY on the data provided below. You never invent, assume, or guess data.

## Authenticated User
User ID: ${userId}

## Strict Rules
1. Answer ONLY using the "Retrieved Data" section below.
2. The data below is the complete set of semantically relevant records. Do not
   use general knowledge or assume records that are not present.
3. Never expose data from a different user.
4. Never invent data that is not present in the retrieved records.
5. Be concise, friendly, and professional.
6. Use bullet points or numbered lists when listing multiple items.

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
  private formatMatches(matches: VectorSearchResult[]): string {
    return matches
      .map((match) => {
        const source = match.sourceContainer ?? 'EmbeddedDocument';
        const data = JSON.stringify(match.sourceData, null, 2);
        return `### ${source} (${match.sourceId ?? match.id})\nSimilarity: ${match.similarity.toFixed(4)}\n\`\`\`json\n${data}\n\`\`\``;
      })
      .join('\n\n');
  }
}
