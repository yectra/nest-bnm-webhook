import { Injectable, Logger } from '@nestjs/common';
import { CrewLlmProvider } from '../../services/crew-llm.provider';
import {
  LeadValidatorState,
  TextModerationResult,
} from '../lead-validator.types';
import { TEXT_MODERATOR_SYSTEM_PROMPT } from '../prompts/validator.prompts';

@Injectable()
export class TextModeratorNode {
  private readonly logger = new Logger(TextModeratorNode.name);

  constructor(private readonly llm: CrewLlmProvider) {}

  async run(state: LeadValidatorState): Promise<Partial<LeadValidatorState>> {
    this.logger.debug(
      `Running TextModeratorNode for Ticket: ${state.ticketId}`,
    );
    const modelUsed = this.llm.getModerationModelName();

    if (!state.userText || state.userText.trim().length === 0) {
      return {
        textModerationResult: {
          isClean: true,
          profanitiesOrViolations: [],
          domainCategory: 'BORDERLINE_NEEDS_INSPECTION',
          inferredCategory: 'Unknown',
          feasibilityScore: 0,
          intentSummary: 'Empty requirement submitted',
          reasoning: 'No text was provided by the user',
          detectedProfanities: [],
          isTextClean: true,
          textQualityScore: 0,
        },
        textModelUsed: modelUsed,
      };
    }

    const userPrompt = `Analyze the following user requirement:\n"${state.userText}"`;

    try {
      const result = await this.llm.completeJson<TextModerationResult>(
        TEXT_MODERATOR_SYSTEM_PROMPT,
        userPrompt,
        modelUsed,
      );

      if (!result) {
        throw new Error('LLM returned null or failed to parse JSON');
      }

      // Populate backward-compatible properties
      const normalizedResult: TextModerationResult = {
        isClean: result.isClean ?? true,
        profanitiesOrViolations: result.profanitiesOrViolations || [],
        domainCategory: result.domainCategory || 'IN_SCOPE_LEGITIMATE',
        inferredCategory: result.inferredCategory || 'Unspecified',
        feasibilityScore:
          typeof result.feasibilityScore === 'number'
            ? result.feasibilityScore
            : 7,
        intentSummary: result.intentSummary || state.userText.slice(0, 100),
        reasoning: result.reasoning || 'Standard intake qualification',
        detectedProfanities: result.profanitiesOrViolations || [],
        isTextClean: result.isClean ?? true,
        textQualityScore:
          typeof result.feasibilityScore === 'number'
            ? result.feasibilityScore
            : 7,
      };

      return {
        textModerationResult: normalizedResult,
        textModelUsed: modelUsed,
      };
    } catch (error: unknown) {
      const errMessage = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Text Moderation failed: ${errMessage}`, errStack);

      // Fallback response to prevent graph failure
      return {
        textModerationResult: {
          isClean: true,
          profanitiesOrViolations: [],
          domainCategory: 'BORDERLINE_NEEDS_INSPECTION',
          inferredCategory: 'Unknown (Error)',
          feasibilityScore: 5,
          intentSummary: state.userText.slice(0, 100),
          reasoning: 'Pipeline error occurred during text moderation',
          detectedProfanities: [],
          isTextClean: true,
          textQualityScore: 5,
        },
        textModelUsed: modelUsed,
      };
    }
  }
}
