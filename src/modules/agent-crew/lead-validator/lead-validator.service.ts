import { Injectable, Logger } from '@nestjs/common';
import {
  LeadValidatorGraphFactory,
  CompiledLeadValidatorGraph,
} from './lead-validator-graph.factory';
import {
  LeadValidationAuditLog,
  LeadValidatorState,
  ValidationReport,
} from './lead-validator.types';
import { MediaPreprocessorService } from './services/media-preprocessor.service';

@Injectable()
export class LeadValidatorService {
  private readonly logger = new Logger(LeadValidatorService.name);
  private graph: CompiledLeadValidatorGraph;

  constructor(
    private readonly graphFactory: LeadValidatorGraphFactory,
    private readonly mediaPreprocessor: MediaPreprocessorService,
  ) {}

  /**
   * Lazily compile the graph to ensure all dependencies are injected.
   */
  private getGraph(): CompiledLeadValidatorGraph {
    if (!this.graph) {
      this.graph = this.graphFactory.build();
    }
    return this.graph;
  }

  /**
   * Main entrypoint to validate a lead.
   * Designed to be called safely without breaking the main flow.
   */
  async validateLead(data: {
    ticketId: string;
    eventType?: string;
    userText: string;
    mediaUrls?: string[];
    declaredCategory?: string;
  }): Promise<ValidationReport> {
    this.logger.debug(
      `Starting lead validation pipeline for ticket: ${data.ticketId}`,
    );

    try {
      // 1. Fallback for declaredCategory if empty or whitespace
      const declaredCategory = data.declaredCategory?.trim()
        ? data.declaredCategory.trim()
        : 'Unspecified';

      // 2. Preprocess attachments (documents, images, audio)
      const { appendedText, processedImages } =
        await this.mediaPreprocessor.processAttachments(data.mediaUrls);
      const combinedUserText = [data.userText, appendedText]
        .filter(Boolean)
        .join('\n\n[Attached Document Content]:\n');

      const graph = this.getGraph();
      const result = await graph.invoke({
        ticketId: data.ticketId,
        eventType: data.eventType || 'POST_YOUR_REQUIREMENTS',
        userText: combinedUserText,
        mediaUrls: processedImages,
        declaredCategory,
      });

      const report = result.finalReport;

      if (!report) {
        throw new Error(
          'Graph execution completed but no ValidationReport was produced.',
        );
      }

      // Output single consolidated, human-readable JSON log
      const auditLog = this.buildStructuredAuditLog(result);
      this.logger.log(`\n${JSON.stringify(auditLog, null, 2)}`);

      return report;
    } catch (error: unknown) {
      const errMessage = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Lead validation pipeline failed for ticket ${data.ticketId}: ${errMessage}`,
        errStack,
      );

      // Return a safe fallback report so callers don't crash
      const fallbackReport: ValidationReport = {
        status: 'FLAGGED_FOR_REVIEW',
        flags: ['SYSTEM_ERROR: Pipeline failed to execute'],
        summary: 'Lead validation failed due to an internal system error.',
        timestamp: new Date().toISOString(),
      };

      const fallbackAuditLog: LeadValidationAuditLog = {
        ticketId: data.ticketId,
        eventType: data.eventType || 'POST_YOUR_REQUIREMENTS',
        timestamp: fallbackReport.timestamp,
        pipelineExecution: {
          stepA_TextModeration: {
            agentName: 'TextModeratorAgent',
            modelUsed: 'gpt-5-mini',
            purpose:
              'Screens profanity, physical feasibility, and BNM domain qualification',
            status: 'FLAGGED',
            analysis: {
              isClean: false,
              domainCategory: 'BORDERLINE_NEEDS_INSPECTION',
              feasibilityScore: '0/10',
              intentSummary: 'Pipeline execution failed',
              profanitiesDetected: [],
              inferredCategory: 'Unknown (Error)',
              reasoning: 'Pipeline failed to execute',
            },
          },
          stepB_VisionAnalysis: {
            agentName: 'VisionAnalystAgent',
            modelUsed: 'gpt-5-mini',
            purpose:
              'Verifies visual evidence against realistic property work sites and category reality',
            status: 'SKIPPED',
            analysis: {
              imagesProcessed: 0,
              detectedVisuals: [],
              isHomeServiceSiteOrPlan: false,
              isRealisticWorkSite: false,
              visualRelevance: 'RELEVANT',
              mismatchReason: 'Pipeline failed to execute',
            },
          },
          stepC_FinalEvaluation: {
            agentName: 'EvaluatorAgent',
            purpose:
              'Consolidates findings from Step A and Step B to generate the final audit status',
            overallDecision: fallbackReport.status,
            domainCategory: 'BORDERLINE_NEEDS_INSPECTION',
            flagsRaised: fallbackReport.flags,
            summary: fallbackReport.summary,
          },
        },
      };

      this.logger.log(`\n${JSON.stringify(fallbackAuditLog, null, 2)}`);

      return fallbackReport;
    }
  }

  private buildStructuredAuditLog(
    state: LeadValidatorState,
  ): LeadValidationAuditLog {
    const textResult = state.textModerationResult;
    const visionResult = state.visionAnalysisResult;
    const finalReport = state.finalReport;
    const hasMedia =
      Array.isArray(state.mediaUrls) && state.mediaUrls.length > 0;

    const domainCategory = textResult?.domainCategory || 'IN_SCOPE_LEGITIMATE';
    const isTextClean =
      textResult?.isClean ?? (textResult?.isTextClean ?? true);
    const violations =
      textResult?.profanitiesOrViolations ||
      textResult?.detectedProfanities ||
      [];
    const feasibilityScore =
      typeof textResult?.feasibilityScore === 'number'
        ? textResult.feasibilityScore
        : (textResult?.textQualityScore ?? 0);

    const isTextPassed =
      isTextClean &&
      violations.length === 0 &&
      domainCategory === 'IN_SCOPE_LEGITIMATE' &&
      feasibilityScore >= 4;

    const visualRelevance =
      visionResult?.visualRelevance ||
      (visionResult?.isImageRelevant === false ? 'MISMATCHED' : 'RELEVANT');
    const isVisionPassed = visualRelevance === 'RELEVANT';

    return {
      ticketId: state.ticketId,
      eventType: state.eventType || 'POST_YOUR_REQUIREMENTS',
      timestamp: finalReport?.timestamp || new Date().toISOString(),
      pipelineExecution: {
        stepA_TextModeration: {
          agentName: 'TextModeratorAgent',
          modelUsed: state.textModelUsed || 'gpt-5-mini',
          purpose:
            'Screens profanity, physical feasibility, and BNM domain qualification',
          status: isTextPassed
            ? 'PASSED'
            : domainCategory === 'IN_SCOPE_LEGITIMATE'
              ? 'FLAGGED'
              : 'REJECTED',
          analysis: {
            isClean: isTextClean,
            domainCategory,
            feasibilityScore: `${feasibilityScore}/10`,
            intentSummary:
              textResult?.intentSummary || state.userText.slice(0, 100),
            profanitiesDetected: violations,
            inferredCategory: textResult?.inferredCategory || 'Unknown',
            reasoning:
              textResult?.reasoning || 'Intake qualification completed',
          },
        },
        stepB_VisionAnalysis: {
          agentName: 'VisionAnalystAgent',
          modelUsed: state.visionModelUsed || 'gpt-5-mini',
          purpose:
            'Verifies visual evidence against realistic property work sites and category reality',
          status: !hasMedia ? 'SKIPPED' : isVisionPassed ? 'PASSED' : 'FLAGGED',
          analysis: {
            imagesProcessed:
              hasMedia && state.mediaUrls
                ? Math.min(state.mediaUrls.length, 4)
                : 0,
            detectedVisuals: visionResult?.detectedElements || [],
            isHomeServiceSiteOrPlan:
              visionResult?.isHomeServiceSiteOrPlan ?? true,
            isRealisticWorkSite: visionResult?.isRealisticWorkSite ?? true,
            visualRelevance,
            mismatchReason: visionResult?.mismatchReason || null,
          },
        },
        stepC_FinalEvaluation: {
          agentName: 'EvaluatorAgent',
          purpose:
            'Consolidates findings from Step A and Step B to generate the final audit status',
          overallDecision: finalReport?.status || 'FLAGGED_FOR_REVIEW',
          domainCategory,
          flagsRaised: finalReport?.flags || [],
          summary: finalReport?.summary || 'Lead validation completed.',
        },
      },
    };
  }
}
