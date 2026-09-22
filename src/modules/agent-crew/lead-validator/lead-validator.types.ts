import { Annotation } from '@langchain/langgraph';
import { CatalogServiceItem } from './services/catalog-fetcher.service';

export type DomainCategory =
  | 'IN_SCOPE_LEGITIMATE'
  | 'ABUSIVE_OR_ILLEGAL'
  | 'FANTASY_UNFEASIBLE'
  | 'OUT_OF_SCOPE'
  | 'BORDERLINE_NEEDS_INSPECTION';

export type EvaluationStatus = 'APPROVED' | 'FLAGGED_FOR_REVIEW' | 'REJECTED';

export type VerificationStatus =
  | 'MATCHED'
  | 'PARTIAL_MATCH'
  | 'MISMATCH'
  | 'INVALID_OR_SPAM';

export type TextValidity = 'VALID' | 'AMBIGUOUS' | 'INVALID';

export type VisualConsistencyVerdict =
  | 'CONSISTENT'
  | 'CONFLICTING'
  | 'IRRELEVANT';

export type RecommendedAction =
  | 'ROUTE_TO_SERVICE'
  | 'REQUIRE_CLARIFICATION'
  | 'REJECT_REQUEST';

export interface Stage1TextSummary {
  identified_intent: string;
  extracted_keywords: string[];
  text_validity: TextValidity;
}

export interface ImageBreakdownItem {
  image_index: number;
  visual_evidence: string;
  aligns_with_text: boolean;
}

export interface Stage2VisualSummary {
  total_images_analyzed: number;
  image_breakdown: ImageBreakdownItem[];
  visual_consistency_verdict: VisualConsistencyVerdict;
}

export interface MatchedServiceItem {
  service_id: string;
  service_name: string;
  category: string;
  relevance_score: number;
  matching_justification: string;
}

export interface RejectionDetails {
  is_rejected: boolean;
  reason_category: string | null;
  explanation: string | null;
}

export interface AnalysisStages {
  stage_1_text_summary: Stage1TextSummary;
  stage_2_visual_summary: Stage2VisualSummary;
  stage_3_verification_notes: string;
}

export interface ServiceVerificationReport {
  status: VerificationStatus;
  confidence_score: number;
  analysis_stages: AnalysisStages;
  matched_services: MatchedServiceItem[];
  rejection_details: RejectionDetails;
  recommended_action: RecommendedAction;

  // Legacy convenience properties for backward compatibility
  flags?: string[];
  summary?: string;
  timestamp?: string;
  legacyStatus?: EvaluationStatus;
}

export type ValidationReport = ServiceVerificationReport;

export interface TextModerationResult {
  isClean?: boolean;
  profanitiesOrViolations?: string[];
  domainCategory?: DomainCategory;
  inferredCategory: string;
  feasibilityScore?: number; // 0 to 10
  intentSummary?: string;
  reasoning?: string;

  // Backward-compatibility convenience properties
  detectedProfanities?: string[];
  isTextClean?: boolean;
  textQualityScore?: number;
}

export interface VisionAnalysisResult {
  detectedElements: string[];
  isHomeServiceSiteOrPlan?: boolean;
  isRealisticWorkSite?: boolean;
  visualRelevance?: 'RELEVANT' | 'MISMATCHED' | 'ABSURD_OR_UNFEASIBLE';
  mismatchReason: string | null;

  // Backward-compatibility
  isImageRelevant?: boolean;
}

export interface StepATextModerationReport {
  agentName: string;
  modelUsed: string;
  purpose: string;
  status: 'PASSED' | 'FLAGGED' | 'REJECTED';
  analysis: {
    isClean: boolean;
    domainCategory: DomainCategory;
    feasibilityScore: string;
    intentSummary: string;
    profanitiesDetected: string[];
    inferredCategory: string;
    reasoning: string;
  };
}

export interface StepBVisionAnalysisReport {
  agentName: string;
  modelUsed: string;
  purpose: string;
  status: 'PASSED' | 'FLAGGED' | 'SKIPPED' | 'REJECTED';
  analysis: {
    imagesProcessed: number;
    detectedVisuals: string[];
    isHomeServiceSiteOrPlan: boolean;
    isRealisticWorkSite: boolean;
    visualRelevance: 'RELEVANT' | 'MISMATCHED' | 'ABSURD_OR_UNFEASIBLE';
    mismatchReason: string | null;
  };
}

export interface StepCFinalEvaluationReport {
  agentName: string;
  purpose: string;
  overallDecision: string;
  domainCategory: DomainCategory;
  flagsRaised: string[];
  summary: string;
}

export interface LeadValidationAuditLog {
  ticketId: string;
  eventType: string;
  timestamp: string;
  pipelineExecution: {
    stepA_TextModeration: StepATextModerationReport;
    stepB_VisionAnalysis: StepBVisionAnalysisReport;
    stepC_FinalEvaluation: StepCFinalEvaluationReport;
  };
}

// Annotation schema for LangGraph StateGraph
export const LeadValidatorStateAnnotation = Annotation.Root({
  ticketId: Annotation<string>,
  eventType: Annotation<string | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
  }),
  userText: Annotation<string>,
  mediaUrls: Annotation<string[]>({
    reducer: (_current, update) => update ?? [],
    default: () => [],
  }),
  declaredCategory: Annotation<string | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
  }),
  catalogServices: Annotation<CatalogServiceItem[] | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
  }),
  textModerationResult: Annotation<TextModerationResult | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
  }),
  textModelUsed: Annotation<string | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
  }),
  visionAnalysisResult: Annotation<VisionAnalysisResult | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
  }),
  visionModelUsed: Annotation<string | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
  }),
  finalReport: Annotation<ValidationReport | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
  }),
});

export type LeadValidatorGraphState = typeof LeadValidatorStateAnnotation.State;

export interface LeadValidatorState {
  ticketId: string;
  userText: string;
  eventType?: string;
  mediaUrls?: string[];
  declaredCategory?: string;
  catalogServices?: CatalogServiceItem[];
  textModerationResult?: TextModerationResult;
  textModelUsed?: string;
  visionAnalysisResult?: VisionAnalysisResult;
  visionModelUsed?: string;
  finalReport?: ValidationReport;
}
