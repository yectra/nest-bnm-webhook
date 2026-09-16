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
      expect(result.finalReport?.status).toBe('APPROVED');
      expect(result.finalReport?.flags).toHaveLength(0);
      expect(
        result.finalReport?.flags.some((f) => f.includes('CATEGORY_MISMATCH')),
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
      expect(result.finalReport?.status).toBe('APPROVED');
      expect(result.finalReport?.flags).toHaveLength(0);
      expect(
        result.finalReport?.flags.some((f) => f.includes('CATEGORY_MISMATCH')),
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
      expect(resultBnm.finalReport?.status).toBe('APPROVED');
      expect(
        resultBnm.finalReport?.flags.some((f) => f.includes('CATEGORY_MISMATCH')),
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
      expect(resultEmpty.finalReport?.status).toBe('APPROVED');
      expect(
        resultEmpty.finalReport?.flags.some((f) => f.includes('CATEGORY_MISMATCH')),
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
      expect(result.finalReport?.status).toBe('APPROVED');
      expect(
        result.finalReport?.flags.some((f) => f.includes('CATEGORY_MISMATCH')),
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
      expect(result.finalReport?.status).toBe('FLAGGED_FOR_REVIEW');
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
      expect(result.finalReport?.status).toBe('REJECTED');
      expect(
        result.finalReport?.flags.some((f) => f.includes('VIOLATION_OR_ABUSE')),
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
      expect(result.finalReport?.status).toBe('REJECTED');
      expect(
        result.finalReport?.flags.some((f) => f.includes('FANTASY_UNFEASIBLE')),
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
      expect(result.finalReport?.status).toBe('REJECTED');
      expect(
        result.finalReport?.flags.some((f) => f.includes('OUT_OF_SCOPE')),
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
      expect(result.finalReport?.status).toBe('FLAGGED_FOR_REVIEW');
      expect(
        result.finalReport?.flags.some((f) =>
          f.includes('BORDERLINE_NEEDS_INSPECTION'),
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
          domainCategory: 'IN_SCOPE_LEGITIMATE',
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
      expect(result.finalReport?.status).toBe('FLAGGED_FOR_REVIEW');
      expect(
        result.finalReport?.flags.some((f) => f.includes('LOW_FEASIBILITY')),
      ).toBe(true);
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
      expect(result.finalReport?.status).toBe('REJECTED');
      expect(result.finalReport?.flags).toContain('TEXT_NOT_CLEAN');
    });

    it('should flag for review if visual relevance is ABSURD_OR_UNFEASIBLE', async () => {
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
      expect(result.finalReport?.status).toBe('FLAGGED_FOR_REVIEW');
      expect(
        result.finalReport?.flags.some((f) => f.includes('VISUAL_ABSURDITY')),
      ).toBe(true);
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
      expect(result.finalReport?.status).toBe('FLAGGED_FOR_REVIEW');
      expect(result.finalReport?.flags).toContain(
        'IMAGE_NOT_RELEVANT: Image does not contain carpentry or furniture',
      );
    });
  });
});
