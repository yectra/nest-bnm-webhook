import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  LeadValidatorGraphFactory,
  CompiledLeadValidatorGraph,
} from './lead-validator-graph.factory';
import {
  LeadValidationAuditLog,
  LeadValidatorState,
  ValidationReport,
  ServiceVerificationReport,
} from './lead-validator.types';
import { MediaPreprocessorService } from './services/media-preprocessor.service';
import {
  CatalogFetcherService,
  FALLBACK_CATALOG_SERVICES,
} from './services/catalog-fetcher.service';

@Injectable()
export class LeadValidatorService {
  private readonly logger = new Logger(LeadValidatorService.name);
  private graph: CompiledLeadValidatorGraph;

  constructor(
    private readonly graphFactory: LeadValidatorGraphFactory,
    private readonly mediaPreprocessor: MediaPreprocessorService,
    @Optional() private readonly catalogFetcher?: CatalogFetcherService,
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

      // 3. Fetch or resolve live catalog
      const catalog = this.catalogFetcher
        ? await this.catalogFetcher.fetchCatalog()
        : FALLBACK_CATALOG_SERVICES;

      const graph = this.getGraph();
      const result = await graph.invoke({
        ticketId: data.ticketId,
        eventType: data.eventType || 'POST_YOUR_REQUIREMENTS',
        userText: combinedUserText,
        mediaUrls: processedImages,
        declaredCategory,
        catalogServices: catalog,
      });

      const report = result.finalReport;

      if (!report) {
        throw new Error(
          'Graph execution completed but no ValidationReport was produced.',
        );
      }

      // Output structured audit log for pipeline audit trail
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

      // Return a safe fallback report conforming to ServiceVerificationReport
      const fallbackReport: ValidationReport = {
        status: 'PARTIAL_MATCH',
        confidence_score: 0.0,
        analysis_stages: {
          stage_1_text_summary: {
            identified_intent: 'Pipeline execution failed',
            extracted_keywords: [],
            text_validity: 'AMBIGUOUS',
          },
          stage_2_visual_summary: {
            total_images_analyzed: 0,
            image_breakdown: [],
            visual_consistency_verdict: 'IRRELEVANT',
          },
          stage_3_verification_notes:
            'Lead validation failed due to an internal system error.',
        },
        matched_services: [],
        rejection_details: {
          is_rejected: false,
          reason_category: 'SYSTEM_ERROR',
          explanation: errMessage,
        },
        recommended_action: 'REQUIRE_CLARIFICATION',
        flags: ['SYSTEM_ERROR: Pipeline failed to execute'],
        summary: 'Lead validation failed due to an internal system error.',
        timestamp: new Date().toISOString(),
        legacyStatus: 'FLAGGED_FOR_REVIEW',
      };

      const fallbackAuditLog: LeadValidationAuditLog = {
        ticketId: data.ticketId,
        eventType: data.eventType || 'POST_YOUR_REQUIREMENTS',
        timestamp: fallbackReport.timestamp!,
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
            flagsRaised: fallbackReport.flags!,
            summary: fallbackReport.summary!,
          },
        },
      };

      this.logger.log(`\n${JSON.stringify(fallbackAuditLog, null, 2)}`);

      return fallbackReport;
    }
  }

  /**
   * Helper method to build structured audit log for audit trail.
   */
  public buildStructuredAuditLog(
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
    const isVisionPassed =
      visualRelevance === 'RELEVANT' &&
      (visionResult?.isRealisticWorkSite ?? true) &&
      (visionResult?.isHomeServiceSiteOrPlan ?? true) &&
      !Boolean(
        visionResult?.mismatchReason &&
          visionResult.mismatchReason.trim().length > 0 &&
          visionResult.mismatchReason !== 'None',
      );


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
          overallDecision: finalReport?.status || 'PARTIAL_MATCH',
          domainCategory,
          flagsRaised: finalReport?.flags || [],
          summary: finalReport?.summary || 'Lead validation completed.',
        },
      },
    };
  }
}
