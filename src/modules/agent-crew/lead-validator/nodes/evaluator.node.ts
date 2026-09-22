import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  LeadValidatorState,
  ServiceVerificationReport,
  ValidationReport,
  VerificationStatus,
  RecommendedAction,
  TextValidity,
  VisualConsistencyVerdict,
  MatchedServiceItem,
} from '../lead-validator.types';
import {
  CatalogFetcherService,
  CatalogServiceItem,
  FALLBACK_CATALOG_SERVICES,
} from '../services/catalog-fetcher.service';
import { CrewLlmProvider } from '../../services/crew-llm.provider';
import {
  SERVICE_VERIFICATION_SYSTEM_PROMPT,
  buildServiceVerificationUserPrompt,
} from '../prompts/validator.prompts';

@Injectable()
export class EvaluatorNode {
  private readonly logger = new Logger(EvaluatorNode.name);

  constructor(
    @Optional() private readonly catalogFetcher?: CatalogFetcherService,
    @Optional() private readonly llm?: CrewLlmProvider,
  ) {}

  async run(state: LeadValidatorState): Promise<Partial<LeadValidatorState>> {
    this.logger.debug(`Running EvaluatorNode for Ticket: ${state.ticketId}`);

    // 1. Resolve Catalog Services
    let catalog = state.catalogServices;
    if (!catalog || catalog.length === 0) {
      if (this.catalogFetcher) {
        catalog = await this.catalogFetcher.fetchCatalog();
      } else {
        catalog = FALLBACK_CATALOG_SERVICES;
      }
    }

    // 2. Multi-Modal Vision LLM Verification (if LLM provider available)
    if (this.llm && state.userText && state.userText.trim().length > 0) {
      try {
        const catalogText = this.catalogFetcher
          ? this.catalogFetcher.formatCatalogForPrompt(catalog)
          : catalog.map((c) => `- ${c.name} (${c.id})`).join('\n');

        const userPrompt = buildServiceVerificationUserPrompt(
          catalogText,
          state.userText,
          state.mediaUrls || [],
          state.declaredCategory,
          state.textModerationResult,
          state.visionAnalysisResult,
        );

        const model = this.llm.getModerationModelName();
        const llmResult =
          await this.llm.completeMultiModalJson<ServiceVerificationReport>(
            SERVICE_VERIFICATION_SYSTEM_PROMPT,
            userPrompt,
            state.mediaUrls || [],
            model,
          );

        if (llmResult && llmResult.status && llmResult.analysis_stages) {
          const rawReport: ValidationReport = {
            ...llmResult,
            flags: llmResult.flags || [],
            summary: llmResult.summary || '',
            timestamp: new Date().toISOString(),
          };

          const finalReport = this.consolidateReport(
            rawReport,
            state,
            catalog,
          );

          return {
            finalReport,
            catalogServices: catalog,
          };
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Multi-modal LLM evaluation encountered an error: ${msg}. Proceeding with deterministic evaluation.`,
        );
      }
    }

    // 3. Deterministic Catalog Matching & Rule Engine
    const finalReport = this.evaluateDeterministically(state, catalog);

    return {
      finalReport,
      catalogServices: catalog,
    };
  }

  /**
   * Deterministic evaluation engine that rigorously maps text and vision analysis
   * against the catalog services, ensuring schema compliance and resilience.
   */
  private evaluateDeterministically(
    state: LeadValidatorState,
    catalog: CatalogServiceItem[],
  ): ValidationReport {
    const textResult = state.textModerationResult;
    const visionResult = state.visionAnalysisResult;
    const flags: string[] = [];

    const isBlankOrEmpty =
      !state.userText || state.userText.trim().length === 0;
    const domainCategory = textResult?.domainCategory || 'IN_SCOPE_LEGITIMATE';
    const isClean = textResult?.isClean ?? (textResult?.isTextClean ?? true);
    const violations =
      textResult?.profanitiesOrViolations ||
      textResult?.detectedProfanities ||
      [];

    // 1. Determine Status & Recommendations
    let status: VerificationStatus = 'MATCHED';
    let textValidity: TextValidity = 'VALID';
    let recommendedAction: RecommendedAction = 'ROUTE_TO_SERVICE';
    let confidenceScore = 0.95;
    let rejectionCategory: string | null = null;
    let rejectionExplanation: string | null = null;

    if (isBlankOrEmpty) {
      status = 'INVALID_OR_SPAM';
      textValidity = 'AMBIGUOUS';
      confidenceScore = 0.0;
      rejectionCategory = 'BLANK_OR_TEST_PAYLOAD';
      rejectionExplanation =
        'Submission is blank or contains an unpopulated test payload with no project scope or site images.';
      recommendedAction = 'REJECT_REQUEST';
      flags.push('BLANK_PAYLOAD');
    } else if (
      domainCategory === 'ABUSIVE_OR_ILLEGAL' ||
      domainCategory === 'FANTASY_UNFEASIBLE' ||
      !isClean ||
      violations.length > 0
    ) {
      status = 'INVALID_OR_SPAM';
      textValidity = 'INVALID';
      confidenceScore = 0.1;
      rejectionCategory =
        domainCategory === 'ABUSIVE_OR_ILLEGAL'
          ? 'ABUSIVE_OR_ILLEGAL'
          : 'FANTASY_UNFEASIBLE';
      rejectionExplanation =
        textResult?.reasoning ||
        'Content contains policy violations, abusive language, or unfeasible requests.';
      recommendedAction = 'REJECT_REQUEST';
      flags.push(`VIOLATION: ${rejectionExplanation}`);
    } else if (domainCategory === 'OUT_OF_SCOPE') {
      status = 'MISMATCH';
      textValidity = 'VALID';
      confidenceScore = 0.2;
      rejectionCategory = 'OUT_OF_SCOPE';
      rejectionExplanation =
        textResult?.reasoning ||
        'Requirement falls completely outside Brick N Mortar civil construction and home services scope.';
      recommendedAction = 'REJECT_REQUEST';
      flags.push(`OUT_OF_SCOPE: ${rejectionExplanation}`);
    } else if (domainCategory === 'BORDERLINE_NEEDS_INSPECTION') {
      status = 'PARTIAL_MATCH';
      textValidity = 'AMBIGUOUS';
      confidenceScore = 0.65;
      recommendedAction = 'REQUIRE_CLARIFICATION';
      flags.push(
        `BORDERLINE: ${textResult?.reasoning || 'Requirement requires structural inspection or additional scope details.'}`,
      );
    }

    // 2. Vision Correlation Check
    let visualVerdict: VisualConsistencyVerdict = 'CONSISTENT';
    const totalImages = state.mediaUrls ? state.mediaUrls.length : 0;
    const hasImages = totalImages > 0;

    const isVisualAbsurd =
      visionResult?.visualRelevance === 'ABSURD_OR_UNFEASIBLE';
    const isVisualMismatched =
      visionResult?.visualRelevance === 'MISMATCHED' ||
      visionResult?.isImageRelevant === false;
    const isNotRealisticWorkSite = visionResult?.isRealisticWorkSite === false;
    const isNotHomeServiceSite =
      visionResult?.isHomeServiceSiteOrPlan === false;
    const hasMismatchReason = Boolean(
      visionResult?.mismatchReason &&
        visionResult.mismatchReason.trim().length > 0 &&
        visionResult.mismatchReason !== 'None',
    );

    const hasVisualConflict =
      hasImages &&
      (isVisualAbsurd ||
        isVisualMismatched ||
        isNotRealisticWorkSite ||
        isNotHomeServiceSite ||
        hasMismatchReason);

    const imageBreakdown = (state.mediaUrls || []).map((url, idx) => {
      const alignsWithText = !hasVisualConflict;
      return {
        image_index: idx + 1,
        visual_evidence:
          visionResult?.detectedElements?.join(', ') ||
          'Visual inspection completed',
        aligns_with_text: alignsWithText,
      };
    });

    if (totalImages === 0) {
      visualVerdict = 'IRRELEVANT';
    } else if (hasVisualConflict) {
      visualVerdict = 'CONFLICTING';
      let visualFlag = '';
      if (isVisualAbsurd) {
        visualFlag = `VISUAL_ABSURDITY: ${visionResult?.mismatchReason || 'Attached visual evidence depicts absurd, unfeasible, or completely unrelated content.'}`;
      } else if (isNotRealisticWorkSite || isNotHomeServiceSite) {
        visualFlag = `NON_WORK_SITE_IMAGE: ${visionResult?.mismatchReason || 'Attached visual evidence does not depict an authentic work site or property.'}`;
      } else {
        visualFlag = `IMAGE_MISMATCH: ${visionResult?.mismatchReason || 'Images conflict with user text requirement.'}`;
      }
      flags.push(visualFlag);

      if (status === 'MATCHED') {
        status = 'PARTIAL_MATCH';
        recommendedAction = 'REQUIRE_CLARIFICATION';
        confidenceScore = Math.min(confidenceScore, 0.65);
      }
    }

    // 3. Category Mismatch Check
    if (textResult?.inferredCategory && state.declaredCategory) {
      const declared = state.declaredCategory.toLowerCase().trim();
      const inferred = textResult.inferredCategory.toLowerCase().trim();
      const genericCategories = [
        'unspecified',
        'general home service',
        'general home services',
        'general service',
        'general',
        'brick n mortar',
        'brick and mortar',
        'home service',
        'none provided',
        'none',
        'other',
        'na',
        'n/a',
        'unknown',
      ];
      const isGeneric =
        !declared ||
        genericCategories.some((g) => declared === g || declared.includes(g));

      if (!isGeneric && !inferred.includes(declared) && !declared.includes(inferred)) {
        flags.push(
          `CATEGORY_MISMATCH: Declared "${state.declaredCategory}", Inferred "${textResult.inferredCategory}"`,
        );
        if (status === 'MATCHED') {
          status = 'PARTIAL_MATCH';
          recommendedAction = 'REQUIRE_CLARIFICATION';
          confidenceScore = 0.7;
        }
      }
    }

    // 4. Catalog Matching
    const matchedServices: MatchedServiceItem[] = [];
    if (status === 'MATCHED' || status === 'PARTIAL_MATCH') {
      const searchTarget = `${textResult?.inferredCategory || ''} ${state.declaredCategory || ''} ${state.userText || ''}`.toLowerCase();

      // Find best match in catalog
      let bestService: CatalogServiceItem | undefined;
      for (const item of catalog) {
        const itemName = item.name.toLowerCase();
        const catName = item.category?.name?.toLowerCase() || '';
        if (
          searchTarget.includes(itemName) ||
          itemName.includes(textResult?.inferredCategory?.toLowerCase() || '___') ||
          (catName && searchTarget.includes(catName))
        ) {
          bestService = item;
          break;
        }
      }

      // Default to Brick N Mortar turnkey service if general construction/renovation
      if (!bestService) {
        bestService =
          catalog.find((c) => c.name === 'Brick N Mortar' || c.name === 'New Construction') ||
          catalog[0];
      }

      if (bestService) {
        matchedServices.push({
          service_id: bestService.id,
          service_name: bestService.name,
          category: bestService.category?.name || bestService.name,
          relevance_score: status === 'MATCHED' ? 0.95 : 0.75,
          matching_justification: `User requirement for "${textResult?.intentSummary || state.userText.slice(0, 60)}" aligns with catalog service "${bestService.name}".`,
        });
      }
    }

    const legacyStatus =
      status === 'MATCHED'
        ? 'APPROVED'
        : status === 'PARTIAL_MATCH'
          ? 'FLAGGED_FOR_REVIEW'
          : 'REJECTED';

    const verificationNotes =
      status === 'MATCHED'
        ? `Request successfully validated against live catalog with ${matchedServices.length} matched service(s).`
        : status === 'PARTIAL_MATCH'
          ? `Request overlaps with catalog scope but requires clarification or physical engineering inspection. Flags: ${flags.join('; ')}`
          : status === 'MISMATCH'
            ? `Request rejected: ${rejectionExplanation || 'Out of catalog scope.'}`
            : `Request rejected as invalid/spam: ${rejectionExplanation || 'Blank or violating payload.'}`;

    const draftReport: ValidationReport = {
      status,
      confidence_score: confidenceScore,
      analysis_stages: {
        stage_1_text_summary: {
          identified_intent:
            textResult?.intentSummary ||
            (isBlankOrEmpty ? 'None provided; blank input' : state.userText.slice(0, 100)),
          extracted_keywords:
            textResult?.inferredCategory && textResult.inferredCategory !== 'Unknown'
              ? [textResult.inferredCategory]
              : [],
          text_validity: textValidity,
        },
        stage_2_visual_summary: {
          total_images_analyzed: totalImages,
          image_breakdown: imageBreakdown,
          visual_consistency_verdict: visualVerdict,
        },
        stage_3_verification_notes: verificationNotes,
      },
      matched_services: matchedServices,
      rejection_details: {
        is_rejected: status === 'MISMATCH' || status === 'INVALID_OR_SPAM',
        reason_category: rejectionCategory,
        explanation: rejectionExplanation,
      },
      recommended_action: recommendedAction,
      flags,
      summary: verificationNotes,
      timestamp: new Date().toISOString(),
      legacyStatus,
    };

    return this.consolidateReport(draftReport, state, catalog);
  }

  /**
   * Consolidates multi-modal report with Step A (text) and Step B (vision) findings,
   * enforcing strict platform rules so that visual conflicts always downgrade MATCHED leads
   * to PARTIAL_MATCH and raise actionable flags for clarification.
   */
  public consolidateReport(
    report: ValidationReport,
    state: LeadValidatorState,
    catalog: CatalogServiceItem[],
  ): ValidationReport {
    const textResult = state.textModerationResult;
    const visionResult = state.visionAnalysisResult;
    const flags: string[] = [...(report.flags || [])];

    const totalImages = state.mediaUrls ? state.mediaUrls.length : 0;
    const hasImages = totalImages > 0;

    const isBlankOrEmpty = !state.userText || state.userText.trim().length === 0;
    const domainCategory = textResult?.domainCategory || 'IN_SCOPE_LEGITIMATE';
    const isClean = textResult?.isClean ?? (textResult?.isTextClean ?? true);
    const violations =
      textResult?.profanitiesOrViolations ||
      textResult?.detectedProfanities ||
      [];

    const isTextLegitimate =
      !isBlankOrEmpty &&
      isClean &&
      violations.length === 0 &&
      (domainCategory === 'IN_SCOPE_LEGITIMATE' ||
        domainCategory === 'BORDERLINE_NEEDS_INSPECTION');

    // Visual conflict signals
    const isVisualAbsurd =
      visionResult?.visualRelevance === 'ABSURD_OR_UNFEASIBLE';
    const isVisualMismatched =
      visionResult?.visualRelevance === 'MISMATCHED' ||
      visionResult?.isImageRelevant === false;
    const isNotRealisticWorkSite = visionResult?.isRealisticWorkSite === false;
    const isNotHomeServiceSite =
      visionResult?.isHomeServiceSiteOrPlan === false;
    const hasMismatchReason = Boolean(
      visionResult?.mismatchReason &&
        visionResult.mismatchReason.trim().length > 0 &&
        visionResult.mismatchReason !== 'None',
    );

    const hasVisualConflict =
      hasImages &&
      (isVisualAbsurd ||
        isVisualMismatched ||
        isNotRealisticWorkSite ||
        isNotHomeServiceSite ||
        hasMismatchReason);

    // 1. Guardrail: Blank payload
    if (isBlankOrEmpty) {
      report.status = 'INVALID_OR_SPAM';
      report.confidence_score = 0.0;
      report.recommended_action = 'REJECT_REQUEST';
      report.rejection_details = {
        is_rejected: true,
        reason_category: 'BLANK_OR_TEST_PAYLOAD',
        explanation: 'Submission is blank or contains an unpopulated test payload with no project scope or site images.',
      };
      if (!flags.includes('BLANK_PAYLOAD')) {
        flags.push('BLANK_PAYLOAD');
      }
    }
    // 2. Guardrail: Text policy violations or fantasy unfeasible
    else if (
      domainCategory === 'ABUSIVE_OR_ILLEGAL' ||
      domainCategory === 'FANTASY_UNFEASIBLE' ||
      !isClean ||
      violations.length > 0
    ) {
      report.status = 'INVALID_OR_SPAM';
      report.recommended_action = 'REJECT_REQUEST';
      report.rejection_details = {
        is_rejected: true,
        reason_category: domainCategory,
        explanation:
          textResult?.reasoning ||
          'Content contains policy violations, abusive language, or unfeasible requests.',
      };
      const violationFlag = `VIOLATION: ${report.rejection_details.explanation}`;
      if (!flags.some((f) => f.startsWith('VIOLATION:'))) {
        flags.push(violationFlag);
      }
    }
    // 3. Guardrail: Out of Scope
    else if (domainCategory === 'OUT_OF_SCOPE') {
      report.status = 'MISMATCH';
      report.recommended_action = 'REJECT_REQUEST';
      report.rejection_details = {
        is_rejected: true,
        reason_category: 'OUT_OF_SCOPE',
        explanation:
          textResult?.reasoning ||
          'Requirement falls completely outside Brick N Mortar civil construction and home services scope.',
      };
      const oosFlag = `OUT_OF_SCOPE: ${report.rejection_details.explanation}`;
      if (!flags.some((f) => f.startsWith('OUT_OF_SCOPE:'))) {
        flags.push(oosFlag);
      }
    }

    // 4. Guardrail: Visual Conflict with genuine text
    if (hasVisualConflict) {
      let visualFlag = '';
      if (isVisualAbsurd) {
        visualFlag = `VISUAL_ABSURDITY: ${visionResult?.mismatchReason || 'Attached visual evidence depicts absurd, unfeasible, or completely unrelated content.'}`;
      } else if (isNotRealisticWorkSite || isNotHomeServiceSite) {
        visualFlag = `NON_WORK_SITE_IMAGE: ${visionResult?.mismatchReason || 'Attached visual evidence does not depict an authentic work site or property.'}`;
      } else {
        visualFlag = `IMAGE_MISMATCH: ${visionResult?.mismatchReason || 'Images conflict with user text requirement.'}`;
      }

      if (
        !flags.some(
          (f) =>
            f.startsWith('IMAGE_MISMATCH:') ||
            f.startsWith('NON_WORK_SITE_IMAGE:') ||
            f.startsWith('VISUAL_ABSURDITY:'),
        )
      ) {
        flags.push(visualFlag);
      }

      // If report has analysis_stages, update stage 2
      if (report.analysis_stages?.stage_2_visual_summary) {
        report.analysis_stages.stage_2_visual_summary.visual_consistency_verdict =
          'CONFLICTING';
        if (
          Array.isArray(
            report.analysis_stages.stage_2_visual_summary.image_breakdown,
          )
        ) {
          report.analysis_stages.stage_2_visual_summary.image_breakdown.forEach(
            (item) => {
              item.aligns_with_text = false;
            },
          );
        }
      }

      // CRITICAL: If text is genuine/in-scope, visual conflicts MUST NOT result in MATCHED or hard REJECT as spam.
      // They MUST result in PARTIAL_MATCH with REQUIRE_CLARIFICATION.
      if (isTextLegitimate) {
        if (report.status === 'MATCHED' || report.status === 'INVALID_OR_SPAM') {
          report.status = 'PARTIAL_MATCH';
          report.recommended_action = 'REQUIRE_CLARIFICATION';
          report.rejection_details = {
            is_rejected: false,
            reason_category: null,
            explanation: null,
          };
          report.confidence_score = Math.min(report.confidence_score, 0.65);
        } else if (report.status === 'PARTIAL_MATCH') {
          report.recommended_action = 'REQUIRE_CLARIFICATION';
          report.confidence_score = Math.min(report.confidence_score, 0.65);
        }
      }
    } else if (totalImages === 0 && report.analysis_stages?.stage_2_visual_summary) {
      report.analysis_stages.stage_2_visual_summary.visual_consistency_verdict =
        'IRRELEVANT';
    }

    // 5. Guardrail: Category Mismatch Check
    if (textResult?.inferredCategory && state.declaredCategory) {
      const declared = state.declaredCategory.toLowerCase().trim();
      const inferred = textResult.inferredCategory.toLowerCase().trim();
      const genericCategories = [
        'unspecified',
        'general home service',
        'general home services',
        'general service',
        'general',
        'brick n mortar',
        'brick and mortar',
        'home service',
        'none provided',
        'none',
        'other',
        'na',
        'n/a',
        'unknown',
      ];
      const isGeneric =
        !declared ||
        genericCategories.some((g) => declared === g || declared.includes(g));

      if (
        !isGeneric &&
        !inferred.includes(declared) &&
        !declared.includes(inferred)
      ) {
        const catMismatchFlag = `CATEGORY_MISMATCH: Declared "${state.declaredCategory}", Inferred "${textResult.inferredCategory}"`;
        if (!flags.some((f) => f.startsWith('CATEGORY_MISMATCH:'))) {
          flags.push(catMismatchFlag);
        }
        if (report.status === 'MATCHED') {
          report.status = 'PARTIAL_MATCH';
          report.recommended_action = 'REQUIRE_CLARIFICATION';
          report.confidence_score = Math.min(report.confidence_score, 0.7);
        }
      }
    }

    // 6. Ensure matched services exist if PARTIAL_MATCH and text is legitimate
    if (
      (report.status === 'MATCHED' || report.status === 'PARTIAL_MATCH') &&
      (!report.matched_services || report.matched_services.length === 0)
    ) {
      const searchTarget = `${textResult?.inferredCategory || ''} ${state.declaredCategory || ''} ${state.userText || ''}`.toLowerCase();
      let bestService = catalog.find(
        (c) =>
          searchTarget.includes(c.name.toLowerCase()) ||
          c.name
            .toLowerCase()
            .includes(textResult?.inferredCategory?.toLowerCase() || '___'),
      );
      if (!bestService) {
        bestService =
          catalog.find(
            (c) => c.name === 'Brick N Mortar' || c.name === 'New Construction',
          ) || catalog[0];
      }
      if (bestService) {
        report.matched_services = [
          {
            service_id: bestService.id,
            service_name: bestService.name,
            category: bestService.category?.name || bestService.name,
            relevance_score: report.status === 'MATCHED' ? 0.95 : 0.75,
            matching_justification: `Requirement overlaps with "${bestService.name}", but attached media requires clarification.`,
          },
        ];
      }
    }

    // 7. Synchronize legacyStatus, summary and flags
    report.flags = flags;
    report.legacyStatus =
      report.status === 'MATCHED'
        ? 'APPROVED'
        : report.status === 'PARTIAL_MATCH'
          ? 'FLAGGED_FOR_REVIEW'
          : 'REJECTED';

    if (report.status === 'PARTIAL_MATCH') {
      const notes = `Request overlaps with catalog scope but requires clarification. Flags: ${flags.join('; ')}`;
      report.summary = notes;
      if (report.analysis_stages) {
        report.analysis_stages.stage_3_verification_notes = notes;
      }
    } else if (report.status === 'MATCHED') {
      report.summary =
        report.summary ||
        `Request successfully validated against live catalog with ${report.matched_services?.length || 0} matched service(s).`;
      if (report.analysis_stages) {
        report.analysis_stages.stage_3_verification_notes = report.summary;
      }
    } else if (report.status === 'MISMATCH') {
      report.summary = `Request rejected: ${report.rejection_details?.explanation || 'Out of catalog scope.'}`;
      if (report.analysis_stages) {
        report.analysis_stages.stage_3_verification_notes = report.summary;
      }
    } else {
      report.summary = `Request rejected as invalid/spam: ${report.rejection_details?.explanation || 'Blank or violating payload.'}`;
      if (report.analysis_stages) {
        report.analysis_stages.stage_3_verification_notes = report.summary;
      }
    }

    return report;
  }
}
