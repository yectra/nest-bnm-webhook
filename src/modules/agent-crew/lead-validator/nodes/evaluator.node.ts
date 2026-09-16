import { Injectable, Logger } from '@nestjs/common';
import { LeadValidatorState, ValidationReport } from '../lead-validator.types';

@Injectable()
export class EvaluatorNode {
  private readonly logger = new Logger(EvaluatorNode.name);

  async run(state: LeadValidatorState): Promise<Partial<LeadValidatorState>> {
    await Promise.resolve();
    this.logger.debug(`Running EvaluatorNode for Ticket: ${state.ticketId}`);

    const textResult = state.textModerationResult;
    const visionResult = state.visionAnalysisResult;

    if (!textResult || !visionResult) {
      this.logger.warn(
        `Missing analysis results for ticket ${state.ticketId}. Text: ${!!textResult}, Vision: ${!!visionResult}`,
      );
    }

    const flags: string[] = [];
    let status: ValidationReport['status'] = 'APPROVED';

    // 1. Text Moderation & BNM Triage Classification Checks
    if (textResult) {
      const domainCategory = textResult.domainCategory || 'IN_SCOPE_LEGITIMATE';

      switch (domainCategory) {
        case 'ABUSIVE_OR_ILLEGAL':
          flags.push(
            `VIOLATION_OR_ABUSE: ${textResult.reasoning || textResult.profanitiesOrViolations?.join(', ') || 'Inappropriate or illegal content detected'}`,
          );
          status = 'REJECTED';
          break;

        case 'FANTASY_UNFEASIBLE':
          flags.push(
            `FANTASY_UNFEASIBLE: ${textResult.reasoning || 'Physically or structurally impossible architectural request'}`,
          );
          status = 'REJECTED';
          break;

        case 'OUT_OF_SCOPE':
          flags.push(
            `OUT_OF_SCOPE: ${textResult.reasoning || 'Requirement is outside Brick N Mortar core home service offerings'}`,
          );
          status = 'REJECTED';
          break;

        case 'BORDERLINE_NEEDS_INSPECTION':
          flags.push(
            `BORDERLINE_NEEDS_INSPECTION: ${textResult.reasoning || 'Complex or ambiguous requirement requiring engineering inspection'}`,
          );
          if (status === 'APPROVED') {
            status = 'FLAGGED_FOR_REVIEW';
          }
          break;

        case 'IN_SCOPE_LEGITIMATE':
        default: {
          const isClean =
            textResult.isClean ?? (textResult.isTextClean ?? true);
          if (!isClean) {
            flags.push('TEXT_NOT_CLEAN');
            status = 'REJECTED';
          }
          const violations =
            textResult.profanitiesOrViolations ||
            textResult.detectedProfanities ||
            [];
          if (violations.length > 0) {
            flags.push(`PROFANITY_DETECTED: ${violations.join(', ')}`);
            if (status === 'APPROVED') status = 'FLAGGED_FOR_REVIEW';
          }
          const feasibility =
            typeof textResult.feasibilityScore === 'number'
              ? textResult.feasibilityScore
              : (textResult.textQualityScore ?? 8);
          if (feasibility < 4) {
            flags.push(`LOW_FEASIBILITY: Feasibility score ${feasibility}/10`);
            if (status === 'APPROVED') status = 'FLAGGED_FOR_REVIEW';
          }
          break;
        }
      }
    }

    // 2. Vision Analysis Checks
    if (visionResult) {
      if (visionResult.visualRelevance === 'ABSURD_OR_UNFEASIBLE') {
        flags.push(
          `VISUAL_ABSURDITY: ${visionResult.mismatchReason || 'Visual evidence is physically absurd or unserviceable'}`,
        );
        if (status === 'APPROVED') status = 'FLAGGED_FOR_REVIEW';
      } else if (
        visionResult.visualRelevance === 'MISMATCHED' ||
        visionResult.isImageRelevant === false
      ) {
        flags.push(
          `IMAGE_NOT_RELEVANT: ${visionResult.mismatchReason || 'Visual evidence does not match declared requirement'}`,
        );
        if (status === 'APPROVED') status = 'FLAGGED_FOR_REVIEW';
      }
    }

    // 3. Category Mismatch Check (Basic Heuristic for Explicit Categories)
    if (textResult?.inferredCategory && state.declaredCategory) {
      const declared = state.declaredCategory.toLowerCase().trim();
      const inferred = textResult.inferredCategory.toLowerCase().trim();

      const genericCategories = [
        'unspecified',
        'general home service',
        'general home services',
        'general service',
        'general services',
        'general',
        'brick n mortar',
        'brick and mortar',
        'home service',
        'home services',
        'none provided',
        'none',
        'other',
        'others',
        'all',
        'na',
        'n/a',
        'unknown',
      ];

      const isGeneric =
        !declared ||
        genericCategories.includes(declared) ||
        declared.includes('general home service') ||
        declared.includes('brick n mortar') ||
        declared.includes('brick and mortar');

      // Only check for mismatch if declared category is specific and non-generic
      if (!isGeneric) {
        if (!inferred.includes(declared) && !declared.includes(inferred)) {
          if (!flags.some((f) => f.includes('MISMATCH'))) {
            flags.push(
              `CATEGORY_MISMATCH: Declared "${state.declaredCategory}", Inferred "${textResult.inferredCategory}"`,
            );
            if (status === 'APPROVED') status = 'FLAGGED_FOR_REVIEW';
          }
        }
      }
    }

    // Generate Summary
    let summary =
      'Lead successfully qualified and verified as legitimate Brick N Mortar requirement.';
    if (status === 'REJECTED') {
      summary = `Lead was rejected: ${flags.join(' | ')}`;
    } else if (status === 'FLAGGED_FOR_REVIEW') {
      summary = `Lead was flagged for manual engineering review: ${flags.join(' | ')}`;
    }

    const finalReport: ValidationReport = {
      status,
      flags,
      summary,
      timestamp: new Date().toISOString(),
    };

    return {
      finalReport,
    };
  }
}
