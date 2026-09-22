import { EvaluatorNode } from './evaluator.node';
import { LeadValidatorState } from '../lead-validator.types';

describe('EvaluatorNode', () => {
  let evaluator: EvaluatorNode;

  beforeEach(() => {
    evaluator = new EvaluatorNode();
  });

  describe('Category Mismatch Checks', () => {
    it('should NOT trigger CATEGORY_MISMATCH when declaredCategory is "Unspecified"', async () => {
      const state: LeadValidatorState = {
        ticketId: 'ticket-1',
        userText: 'Need pipeline and bathroom tap fixing',
        mediaUrls: [],
        declaredCategory: 'Unspecified',
        textModerationResult: {
          isTextClean: true,
          detectedProfanities: [],
          inferredCategory: 'Plumbing',
          textQualityScore: 8,
        },
        visionAnalysisResult: {
          detectedElements: [],
          isImageRelevant: true,
          mismatchReason: null,
        },
      };

      const result = await evaluator.run(state);
      expect(result.finalReport?.status).toBe('MATCHED');
      expect(result.finalReport?.legacyStatus).toBe('APPROVED');
      expect(result.finalReport?.recommended_action).toBe('ROUTE_TO_SERVICE');
      expect(result.finalReport?.confidence_score).toBeGreaterThan(0.8);
      expect(result.finalReport?.matched_services.length).toBeGreaterThan(0);
      expect(result.finalReport?.flags).toHaveLength(0);
      expect(
        result.finalReport?.flags?.some((f) => f.includes('CATEGORY_MISMATCH')),
      ).toBe(false);
    });

    it('should NOT trigger CATEGORY_MISMATCH when declaredCategory is "General Home Service" and AI infers "Modular Kitchen"', async () => {
      const state: LeadValidatorState = {
        ticketId: 'ticket-ghs',
        userText: 'Need L-shaped modular kitchen with acrylic finish and chimney',
        mediaUrls: [],
        declaredCategory: 'General Home Service',
        textModerationResult: {
          isTextClean: true,
          detectedProfanities: [],
          inferredCategory: 'Modular Kitchen',
          textQualityScore: 9,
        },
        visionAnalysisResult: {
          detectedElements: [],
          isImageRelevant: true,
          mismatchReason: null,
        },
      };

      const result = await evaluator.run(state);
      expect(result.finalReport?.status).toBe('MATCHED');
      expect(result.finalReport?.legacyStatus).toBe('APPROVED');
      expect(result.finalReport?.recommended_action).toBe('ROUTE_TO_SERVICE');
      expect(result.finalReport?.flags).toHaveLength(0);
      expect(
        result.finalReport?.flags?.some((f) => f.includes('CATEGORY_MISMATCH')),
      ).toBe(false);
    });

    it('should NOT trigger CATEGORY_MISMATCH when declaredCategory is "Brick N Mortar" or empty', async () => {
      const stateBnm: LeadValidatorState = {
        ticketId: 'ticket-bnm',
        userText: 'Need complete house construction contractor',
        mediaUrls: [],
        declaredCategory: 'Brick N Mortar',
        textModerationResult: {
          isTextClean: true,
          detectedProfanities: [],
          inferredCategory: 'Civil Construction',
          textQualityScore: 9,
        },
        visionAnalysisResult: {
          detectedElements: [],
          isImageRelevant: true,
          mismatchReason: null,
        },
      };

      const resultBnm = await evaluator.run(stateBnm);
      expect(resultBnm.finalReport?.status).toBe('MATCHED');
      expect(resultBnm.finalReport?.legacyStatus).toBe('APPROVED');
      expect(
        resultBnm.finalReport?.flags?.some((f) => f.includes('CATEGORY_MISMATCH')),
      ).toBe(false);

      const stateEmpty: LeadValidatorState = {
        ticketId: 'ticket-empty',
        userText: 'Need bathroom waterproofing',
        mediaUrls: [],
        declaredCategory: '',
        textModerationResult: {
          isTextClean: true,
          detectedProfanities: [],
          inferredCategory: 'Waterproofing',
          textQualityScore: 8,
        },
        visionAnalysisResult: {
          detectedElements: [],
          isImageRelevant: true,
          mismatchReason: null,
        },
      };

      const resultEmpty = await evaluator.run(stateEmpty);
      expect(resultEmpty.finalReport?.status).toBe('MATCHED');
      expect(resultEmpty.finalReport?.legacyStatus).toBe('APPROVED');
      expect(
        resultEmpty.finalReport?.flags?.some((f) => f.includes('CATEGORY_MISMATCH')),
      ).toBe(false);
    });

    it('should NOT trigger CATEGORY_MISMATCH when declaredCategory is generic like "None provided" or "General"', async () => {
      const state: LeadValidatorState = {
        ticketId: 'ticket-2',
        userText: 'Need 3 rooms painted',
        mediaUrls: [],
        declaredCategory: 'None provided',
        textModerationResult: {
          isTextClean: true,
          detectedProfanities: [],
          inferredCategory: 'Painting',
          textQualityScore: 8,
        },
        visionAnalysisResult: {
          detectedElements: [],
          isImageRelevant: true,
          mismatchReason: null,
        },
      };

      const result = await evaluator.run(state);
      expect(result.finalReport?.status).toBe('MATCHED');
      expect(result.finalReport?.legacyStatus).toBe('APPROVED');
      expect(
        result.finalReport?.flags?.some((f) => f.includes('CATEGORY_MISMATCH')),
      ).toBe(false);
    });

    it('should trigger CATEGORY_MISMATCH when declaredCategory is specific and contradicts inferredCategory', async () => {
      const state: LeadValidatorState = {
        ticketId: 'ticket-3',
        userText: 'Need water leakage in kitchen sink repaired',
        mediaUrls: [],
        declaredCategory: 'Plumbing',
        textModerationResult: {
          isTextClean: true,
          detectedProfanities: [],
          inferredCategory: 'Civil Painting',
          textQualityScore: 8,
        },
        visionAnalysisResult: {
          detectedElements: [],
          isImageRelevant: true,
          mismatchReason: null,
        },
      };

      const result = await evaluator.run(state);
      expect(result.finalReport?.status).toBe('PARTIAL_MATCH');
      expect(result.finalReport?.legacyStatus).toBe('FLAGGED_FOR_REVIEW');
      expect(result.finalReport?.recommended_action).toBe('REQUIRE_CLARIFICATION');
      expect(result.finalReport?.flags).toContain(
        'CATEGORY_MISMATCH: Declared "Plumbing", Inferred "Civil Painting"',
      );
    });
  });

  describe('BNM Domain Triage Classification & Feasibility', () => {
    it('should reject leads classified as ABUSIVE_OR_ILLEGAL', async () => {
      const state: LeadValidatorState = {
        ticketId: 'ticket-abuse',
        userText: 'I will destroy your office you thieves',
        mediaUrls: [],
        declaredCategory: 'Unspecified',
        textModerationResult: {
          isClean: false,
          profanitiesOrViolations: ['threat', 'harassment'],
          domainCategory: 'ABUSIVE_OR_ILLEGAL',
          inferredCategory: 'Unknown',
          feasibilityScore: 0,
          intentSummary: 'Threatening communication',
          reasoning: 'Abusive language and personal threats detected',
        },
        visionAnalysisResult: {
          detectedElements: [],
          isImageRelevant: true,
          mismatchReason: null,
        },
      };

      const result = await evaluator.run(state);
      expect(result.finalReport?.status).toBe('INVALID_OR_SPAM');
      expect(result.finalReport?.legacyStatus).toBe('REJECTED');
      expect(result.finalReport?.recommended_action).toBe('REJECT_REQUEST');
      expect(result.finalReport?.rejection_details.is_rejected).toBe(true);
      expect(
        result.finalReport?.flags?.some((f) => f.includes('VIOLATION')),
      ).toBe(true);
    });

    it('should reject leads classified as FANTASY_UNFEASIBLE', async () => {
      const state: LeadValidatorState = {
        ticketId: 'ticket-fantasy',
        userText: 'Build a 3-storey villa hanging from an oak tree with a glass pool',
        mediaUrls: [],
        declaredCategory: 'Civil Construction',
        textModerationResult: {
          isClean: true,
          profanitiesOrViolations: [],
          domainCategory: 'FANTASY_UNFEASIBLE',
          inferredCategory: 'Civil Construction',
          feasibilityScore: 1,
          intentSummary: 'Hanging tree villa with pool',
          reasoning: 'Physically impossible structural request that violates basic engineering laws',
        },
        visionAnalysisResult: {
          detectedElements: [],
          isImageRelevant: true,
          mismatchReason: null,
        },
      };

      const result = await evaluator.run(state);
      expect(result.finalReport?.status).toBe('INVALID_OR_SPAM');
      expect(result.finalReport?.legacyStatus).toBe('REJECTED');
      expect(result.finalReport?.recommended_action).toBe('REJECT_REQUEST');
      expect(
        result.finalReport?.flags?.some((f) => f.includes('VIOLATION')),
      ).toBe(true);
    });

    it('should reject leads classified as OUT_OF_SCOPE with explanatory flag', async () => {
      const state: LeadValidatorState = {
        ticketId: 'ticket-oos',
        userText: 'Need 50 acres of agricultural farm land near Mysore',
        mediaUrls: [],
        declaredCategory: 'Real Estate',
        textModerationResult: {
          isClean: true,
          profanitiesOrViolations: [],
          domainCategory: 'OUT_OF_SCOPE',
          inferredCategory: 'Land Brokerage',
          feasibilityScore: 2,
          intentSummary: 'Agricultural land purchase',
          reasoning: 'Requirement is for raw land acquisition, which is outside Brick N Mortar construction & renovation services',
        },
        visionAnalysisResult: {
          detectedElements: [],
          isImageRelevant: true,
          mismatchReason: null,
        },
      };

      const result = await evaluator.run(state);
      expect(result.finalReport?.status).toBe('MISMATCH');
      expect(result.finalReport?.legacyStatus).toBe('REJECTED');
      expect(result.finalReport?.recommended_action).toBe('REJECT_REQUEST');
      expect(result.finalReport?.rejection_details.is_rejected).toBe(true);
      expect(
        result.finalReport?.flags?.some((f) => f.includes('OUT_OF_SCOPE')),
      ).toBe(true);
    });

    it('should flag leads classified as BORDERLINE_NEEDS_INSPECTION for engineering review', async () => {
      const state: LeadValidatorState = {
        ticketId: 'ticket-borderline',
        userText: 'Deep structural foundation crack causing house tilting on marshy soil',
        mediaUrls: [],
        declaredCategory: 'Civil Construction',
        textModerationResult: {
          isClean: true,
          profanitiesOrViolations: [],
          domainCategory: 'BORDERLINE_NEEDS_INSPECTION',
          inferredCategory: 'Structural Repair',
          feasibilityScore: 5,
          intentSummary: 'Foundation crack and tilting house',
          reasoning: 'Severe structural stability risk requiring on-site structural engineer assessment',
        },
        visionAnalysisResult: {
          detectedElements: [],
          isImageRelevant: true,
          mismatchReason: null,
        },
      };

      const result = await evaluator.run(state);
      expect(result.finalReport?.status).toBe('PARTIAL_MATCH');
      expect(result.finalReport?.legacyStatus).toBe('FLAGGED_FOR_REVIEW');
      expect(result.finalReport?.recommended_action).toBe('REQUIRE_CLARIFICATION');
      expect(
        result.finalReport?.flags?.some((f) =>
          f.includes('BORDERLINE'),
        ),
      ).toBe(true);
    });

    it('should flag IN_SCOPE_LEGITIMATE leads with feasibilityScore < 4', async () => {
      const state: LeadValidatorState = {
        ticketId: 'ticket-low-feasibility',
        userText: 'Plumbing work for whole building in 10 minutes for 50 rupees',
        mediaUrls: [],
        declaredCategory: 'Plumbing',
        textModerationResult: {
          isClean: true,
          profanitiesOrViolations: [],
          domainCategory: 'BORDERLINE_NEEDS_INSPECTION',
          inferredCategory: 'Plumbing',
          feasibilityScore: 2,
          intentSummary: 'Plumbing for entire building',
          reasoning: 'Cost and timeframe expectations are unfeasible',
        },
        visionAnalysisResult: {
          detectedElements: [],
          isImageRelevant: true,
          mismatchReason: null,
        },
      };

      const result = await evaluator.run(state);
      expect(result.finalReport?.status).toBe('PARTIAL_MATCH');
      expect(result.finalReport?.legacyStatus).toBe('FLAGGED_FOR_REVIEW');
      expect(result.finalReport?.recommended_action).toBe('REQUIRE_CLARIFICATION');
    });
  });

  describe('Text Moderation & Vision Flags', () => {
    it('should reject immediately if text is not clean', async () => {
      const state: LeadValidatorState = {
        ticketId: 'ticket-4',
        userText: 'Abusive spam message',
        mediaUrls: [],
        declaredCategory: 'Unspecified',
        textModerationResult: {
          isClean: false,
          profanitiesOrViolations: ['badword'],
          domainCategory: 'IN_SCOPE_LEGITIMATE',
          inferredCategory: 'Unknown',
          feasibilityScore: 1,
          intentSummary: 'Abusive spam',
          reasoning: 'Contains profanity',
        },
        visionAnalysisResult: {
          detectedElements: [],
          isImageRelevant: true,
          mismatchReason: null,
        },
      };

      const result = await evaluator.run(state);
      expect(result.finalReport?.status).toBe('INVALID_OR_SPAM');
      expect(result.finalReport?.legacyStatus).toBe('REJECTED');
      expect(result.finalReport?.recommended_action).toBe('REJECT_REQUEST');
      expect(result.finalReport?.flags).toContain('VIOLATION: Contains profanity');
    });

    it('should flag for review (PARTIAL_MATCH) if visual relevance is ABSURD_OR_UNFEASIBLE but text is genuine', async () => {
      const state: LeadValidatorState = {
        ticketId: 'ticket-absurd-img',
        userText: 'Need living room false ceiling and lighting',
        mediaUrls: ['https://example.com/dense_jungle.jpg'],
        declaredCategory: 'Interior Design',
        textModerationResult: {
          isClean: true,
          profanitiesOrViolations: [],
          domainCategory: 'IN_SCOPE_LEGITIMATE',
          inferredCategory: 'Interior Design',
          feasibilityScore: 9,
          intentSummary: 'False ceiling and lighting',
          reasoning: 'Standard interior service',
        },
        visionAnalysisResult: {
          detectedElements: ['dense forest with wild elephants'],
          visualRelevance: 'ABSURD_OR_UNFEASIBLE',
          isHomeServiceSiteOrPlan: false,
          isRealisticWorkSite: false,
          mismatchReason: 'Visual evidence depicts wild jungle instead of any property or construction site',
        },
      };

      const result = await evaluator.run(state);
      expect(result.finalReport?.status).toBe('PARTIAL_MATCH');
      expect(result.finalReport?.legacyStatus).toBe('FLAGGED_FOR_REVIEW');
      expect(result.finalReport?.recommended_action).toBe('REQUIRE_CLARIFICATION');
      expect(result.finalReport?.rejection_details.is_rejected).toBe(false);
      expect(
        result.finalReport?.flags?.some((f) => f.includes('VISUAL_ABSURDITY')),
      ).toBe(true);
      expect(
        result.finalReport?.analysis_stages.stage_2_visual_summary
          .visual_consistency_verdict,
      ).toBe('CONFLICTING');
    });

    it('should flag for review (PARTIAL_MATCH) and raise NON_WORK_SITE_IMAGE when text is genuine but visual depicts an unrelated car/automobile', async () => {
      const state: LeadValidatorState = {
        ticketId: 'ticket-car-img',
        userText: 'Need complete house exterior painting in Bangalore',
        mediaUrls: ['https://example.com/car.jpg'],
        declaredCategory: 'Painting',
        textModerationResult: {
          isClean: true,
          profanitiesOrViolations: [],
          domainCategory: 'IN_SCOPE_LEGITIMATE',
          inferredCategory: 'Painting',
          feasibilityScore: 9,
          intentSummary: 'House exterior painting',
          reasoning: 'Standard civil painting service',
        },
        visionAnalysisResult: {
          detectedElements: ['red sedan car parked on street'],
          visualRelevance: 'MISMATCHED',
          isHomeServiceSiteOrPlan: false,
          isRealisticWorkSite: false,
          mismatchReason: 'Image depicts an automobile/car, unrelated to residential painting or construction work site',
        },
      };

      const result = await evaluator.run(state);
      expect(result.finalReport?.status).toBe('PARTIAL_MATCH');
      expect(result.finalReport?.legacyStatus).toBe('FLAGGED_FOR_REVIEW');
      expect(result.finalReport?.recommended_action).toBe('REQUIRE_CLARIFICATION');
      expect(result.finalReport?.flags).toBeDefined();
      expect(
        result.finalReport?.flags?.some((f) => f.includes('NON_WORK_SITE_IMAGE')),
      ).toBe(true);
      expect(
        result.finalReport?.analysis_stages.stage_2_visual_summary
          .visual_consistency_verdict,
      ).toBe('CONFLICTING');
    });

    it('should flag for review if image is not relevant (MISMATCHED)', async () => {
      const state: LeadValidatorState = {
        ticketId: 'ticket-5',
        userText: 'Fix broken wooden table',
        mediaUrls: ['https://example.com/random.jpg'],
        declaredCategory: 'Carpentry',
        textModerationResult: {
          isClean: true,
          profanitiesOrViolations: [],
          domainCategory: 'IN_SCOPE_LEGITIMATE',
          inferredCategory: 'Carpentry',
          feasibilityScore: 9,
          intentSummary: 'Fix broken wooden table',
          reasoning: 'Standard carpentry repair',
        },
        visionAnalysisResult: {
          detectedElements: ['a gaming screenshot'],
          visualRelevance: 'MISMATCHED',
          isImageRelevant: false,
          mismatchReason: 'Image does not contain carpentry or furniture',
        },
      };

      const result = await evaluator.run(state);
      expect(result.finalReport?.status).toBe('PARTIAL_MATCH');
      expect(result.finalReport?.legacyStatus).toBe('FLAGGED_FOR_REVIEW');
      expect(result.finalReport?.recommended_action).toBe('REQUIRE_CLARIFICATION');
      expect(result.finalReport?.flags).toContain(
        'IMAGE_MISMATCH: Image does not contain carpentry or furniture',
      );
    });

    it('should return INVALID_OR_SPAM for blank inputs', async () => {
      const state: LeadValidatorState = {
        ticketId: 'ticket-blank',
        userText: '',
        mediaUrls: [],
        declaredCategory: '',
      };

      const result = await evaluator.run(state);
      expect(result.finalReport?.status).toBe('INVALID_OR_SPAM');
      expect(result.finalReport?.confidence_score).toBe(0.0);
      expect(result.finalReport?.rejection_details.is_rejected).toBe(true);
      expect(result.finalReport?.recommended_action).toBe('REJECT_REQUEST');
      expect(result.finalReport?.analysis_stages.stage_1_text_summary.text_validity).toBe('AMBIGUOUS');
    });

    it('should consolidate LLM result and downgrade MATCHED to PARTIAL_MATCH when vision analysis flagged an unrelated car image', async () => {
      const mockLlm = {
        getModerationModelName: jest.fn().mockReturnValue('gpt-5-mini'),
        completeMultiModalJson: jest.fn().mockResolvedValue({
          status: 'MATCHED',
          confidence_score: 0.95,
          analysis_stages: {
            stage_1_text_summary: {
              identified_intent: 'Painting request',
              extracted_keywords: ['Painting'],
              text_validity: 'VALID',
            },
            stage_2_visual_summary: {
              total_images_analyzed: 1,
              image_breakdown: [
                {
                  image_index: 1,
                  visual_evidence: 'Attached photo',
                  aligns_with_text: true,
                },
              ],
              visual_consistency_verdict: 'CONSISTENT',
            },
            stage_3_verification_notes: 'Validated against catalog',
          },
          matched_services: [
            {
              service_id: '33941d44-41df-4d92-b7e1-24a3fb4c7cb4',
              service_name: 'Painting',
              category: 'Painting',
              relevance_score: 0.95,
              matching_justification: 'Matches painting catalog service',
            },
          ],
          rejection_details: {
            is_rejected: false,
            reason_category: null,
            explanation: null,
          },
          recommended_action: 'ROUTE_TO_SERVICE',
          flags: [],
        }),
      } as any;

      const evaluatorWithLlm = new EvaluatorNode(undefined, mockLlm);

      const state: LeadValidatorState = {
        ticketId: 'ticket-llm-consolidation',
        userText: 'Need 3BHK interior painting in Koramangala',
        mediaUrls: ['https://example.com/car-photo.jpg'],
        declaredCategory: 'Painting',
        textModerationResult: {
          isClean: true,
          profanitiesOrViolations: [],
          domainCategory: 'IN_SCOPE_LEGITIMATE',
          inferredCategory: 'Painting',
          feasibilityScore: 9,
          intentSummary: 'Interior painting in Koramangala',
          reasoning: 'Genuine painting requirement',
        },
        visionAnalysisResult: {
          detectedElements: ['white sports car in garage'],
          visualRelevance: 'MISMATCHED',
          isHomeServiceSiteOrPlan: false,
          isRealisticWorkSite: false,
          mismatchReason: 'Image depicts an automobile/car rather than a painting work site',
        },
      };

      const result = await evaluatorWithLlm.run(state);

      // Verify consolidation guardrails:
      // Status MUST NOT be MATCHED
      expect(result.finalReport?.status).toBe('PARTIAL_MATCH');
      expect(result.finalReport?.legacyStatus).toBe('FLAGGED_FOR_REVIEW');
      expect(result.finalReport?.recommended_action).toBe('REQUIRE_CLARIFICATION');
      expect(result.finalReport?.confidence_score).toBeLessThanOrEqual(0.65);
      expect(
        result.finalReport?.analysis_stages.stage_2_visual_summary
          .visual_consistency_verdict,
      ).toBe('CONFLICTING');
      expect(result.finalReport?.flags).toBeDefined();
      expect(result.finalReport?.flags?.length).toBeGreaterThan(0);
      expect(
        result.finalReport?.flags?.some((f) => f.includes('NON_WORK_SITE_IMAGE')),
      ).toBe(true);
    });
  });
});
