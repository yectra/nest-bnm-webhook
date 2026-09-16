import { Annotation } from '@langchain/langgraph';

export type DomainCategory =
  | 'IN_SCOPE_LEGITIMATE'
  | 'ABUSIVE_OR_ILLEGAL'
  | 'FANTASY_UNFEASIBLE'
  | 'OUT_OF_SCOPE'
  | 'BORDERLINE_NEEDS_INSPECTION';

export type EvaluationStatus = 'APPROVED' | 'FLAGGED_FOR_REVIEW' | 'REJECTED';

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

export interface ValidationReport {
  status: EvaluationStatus;
  flags: string[];
  summary: string;
  timestamp: string;
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
  overallDecision: EvaluationStatus;
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
  textModerationResult?: TextModerationResult;
  textModelUsed?: string;
  visionAnalysisResult?: VisionAnalysisResult;
  visionModelUsed?: string;
  finalReport?: ValidationReport;
}
