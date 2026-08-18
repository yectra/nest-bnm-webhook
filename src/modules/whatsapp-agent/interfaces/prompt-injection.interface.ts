/** Severity assigned to a single matched injection rule. */
export type PromptInjectionSeverity = 'low' | 'medium' | 'high' | 'critical';

/** Overall verdict for a scanned text. `none` means nothing matched. */
export type PromptInjectionRisk = 'none' | PromptInjectionSeverity;

/** One heuristic rule in the adversarial-input guard. */
export interface PromptInjectionRule {
  /** Stable id used in logs so alerts can be grepped/aggregated. */
  id: string;
  label: string;
  category: string;
  severity: PromptInjectionSeverity;
  pattern: RegExp;
}

/** A rule that fired on the analyzed text. */
export interface PromptInjectionSignal {
  ruleId: string;
  label: string;
  category: string;
  severity: PromptInjectionSeverity;
  /** Short, trimmed snippet of the offending text (never the whole message). */
  excerpt: string;
  /** True when the match came from a decoded (e.g. base64) segment. */
  decoded?: boolean;
}

/** Result of the deterministic (no-network) scan. */
export interface PromptInjectionScanResult {
  detected: boolean;
  risk: PromptInjectionRisk;
  /** Weighted sum of the matched rule severities. */
  score: number;
  signals: PromptInjectionSignal[];
  analyzedChars: number;
  truncated: boolean;
}

/** Verdict returned by the optional LangGraph deep-agent review pass. */
export interface PromptInjectionReviewResult {
  status: 'skipped' | 'completed' | 'failed';
  detected?: boolean;
  risk?: PromptInjectionRisk;
  reason?: string;
}

/** A single customer-authored text field pulled out of the Java event. */
export interface RequirementTextField {
  /** Dotted path inside `event.data`, e.g. `requirement.description`. */
  path: string;
  value: string;
}

/** Normalized "Post Your Requirements" submission carried by the Java event. */
export interface RequirementSubmission {
  phone?: string;
  name?: string;
  referenceId?: string;
  fields: RequirementTextField[];
}

/** Per-field scan outcome reported for one event. */
export interface RequirementFieldScan {
  path: string;
  scan: PromptInjectionScanResult;
}

/** Full report logged for one inbound Java event. */
export interface PromptInjectionEventReport {
  eventId: string;
  eventType: string;
  /** Phone number masked for logging (never logged in full). */
  maskedPhone: string;
  referenceId?: string;
  detected: boolean;
  risk: PromptInjectionRisk;
  score: number;
  scannedFields: number;
  fieldScans: RequirementFieldScan[];
}
