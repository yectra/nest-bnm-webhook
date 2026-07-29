import { Injectable } from '@nestjs/common';
import { VectorSearchResult } from '../interfaces/vector-search.interface';

@Injectable()
export class PromptBuilderService {
  buildPrompt(
    history: { role: string; content: string }[],
    matches: VectorSearchResult[],
    question: string,
    userId: string = 'anonymous',
    domain?: string,
  ): string {
    const formattedHistory = history
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');

    const knowledgeSection = matches.length > 0
      ? matches
          .map((m) => {
            const container = m.sourceContainer ?? 'KnowledgeBase';
            const dataStr = JSON.stringify(m.sourceData ?? {}, null, 2);
            return `### ${container} (${m.id})\nSimilarity: ${m.similarity.toFixed(4)}\n\`\`\`json\n${dataStr}\n\`\`\``;
          })
          .join('\n\n')
      : '(No additional database records retrieved)';

    return `
You are a senior AI business assistant for BrickNMortar platform.
Domain Context: ${domain ?? 'GENERAL'}
Authenticated User: ${userId}

## System Instructions
1. Answer the user question accurately, professionally, and concisely.
2. Use the "Retrieved Knowledge" section whenever relevant to ground your response.
3. If no knowledge matches are found, use your internal knowledge to assist constructively while noting general context.
4. Maintain a helpful and polite tone.

## Retrieved Knowledge
${knowledgeSection}

## Conversation History
${formattedHistory || '(No prior turns)'}

## User Question
${question}

## AI Response:
`;
  }
}
