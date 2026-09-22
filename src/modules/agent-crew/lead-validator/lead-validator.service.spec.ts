import { LeadValidatorService } from './lead-validator.service';
import { LeadValidatorGraphFactory } from './lead-validator-graph.factory';
import { LeadValidatorState } from './lead-validator.types';
import { MediaPreprocessorService } from './services/media-preprocessor.service';
import { CatalogFetcherService } from './services/catalog-fetcher.service';
import { Logger } from '@nestjs/common';

describe('LeadValidatorService', () => {
  let service: LeadValidatorService;
  let mockGraphFactory: jest.Mocked<LeadValidatorGraphFactory>;
  let mockMediaPreprocessor: jest.Mocked<MediaPreprocessorService>;
  let mockCatalogFetcher: jest.Mocked<CatalogFetcherService>;
  let loggerLogSpy: jest.SpyInstance;

  beforeEach(() => {
    loggerLogSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});

    mockMediaPreprocessor = {
      processAttachments: jest
        .fn()
        .mockImplementation(async (mediaUrls?: string[]) => {
          return {
            appendedText: '',
            processedImages: mediaUrls || [],
          };
        }),
    } as unknown as jest.Mocked<MediaPreprocessorService>;

    mockCatalogFetcher = {
      fetchCatalog: jest.fn().mockResolvedValue([
        {
          id: '33941d44-41df-4d92-b7e1-24a3fb4c7cb4',
          name: 'Interior Works',
          category: { name: 'Interior Works' },
        },
      ]),
      formatCatalogForPrompt: jest.fn().mockReturnValue('Mock formatted catalog'),
    } as unknown as jest.Mocked<CatalogFetcherService>;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should compile and log the exact structured JSON for requirement lead', async () => {
    const mockInvokeResult: LeadValidatorState = {
      ticketId: 'ticket-123',
      eventType: 'POST_YOUR_REQUIREMENT',
      userText: 'Need 3BHK interior renovation in Indiranagar',
      mediaUrls: ['https://example.com/drawing.jpg'],
      declaredCategory: 'Interior Design',
      textModelUsed: 'gpt-5-mini',
      visionModelUsed: 'gpt-5-mini',
      textModerationResult: {
        isClean: true,
        profanitiesOrViolations: [],
        domainCategory: 'IN_SCOPE_LEGITIMATE',
        inferredCategory: 'Interior Design',
        feasibilityScore: 9,
        intentSummary: 'Need 3BHK interior renovation in Indiranagar',
        reasoning: 'Standard interior service within BNM scope',
      },
      visionAnalysisResult: {
        detectedElements: ['living room with wooden TV unit'],
        isHomeServiceSiteOrPlan: true,
        isRealisticWorkSite: true,
        visualRelevance: 'RELEVANT',
        isImageRelevant: true,
        mismatchReason: null,
      },
      finalReport: {
        status: 'MATCHED',
        confidence_score: 0.95,
        analysis_stages: {
          stage_1_text_summary: {
            identified_intent: 'Need 3BHK interior renovation in Indiranagar',
            extracted_keywords: ['Interior Design'],
            text_validity: 'VALID',
          },
          stage_2_visual_summary: {
            total_images_analyzed: 1,
            image_breakdown: [
              {
                image_index: 1,
                visual_evidence: 'living room with wooden TV unit',
                aligns_with_text: true,
              },
            ],
            visual_consistency_verdict: 'CONSISTENT',
          },
          stage_3_verification_notes:
            'User text and visual evidence perfectly align with declared Interior Design category.',
        },
        matched_services: [
          {
            service_id: '33941d44-41df-4d92-b7e1-24a3fb4c7cb4',
            service_name: 'Interior Works',
            category: 'Interior Works',
            relevance_score: 0.95,
            matching_justification: 'Interior design and renovation works',
          },
        ],
        rejection_details: {
          is_rejected: false,
          reason_category: null,
          explanation: null,
        },
        recommended_action: 'ROUTE_TO_SERVICE',
        legacyStatus: 'APPROVED',
        flags: [],
        summary:
          'User text and visual evidence perfectly align with declared Interior Design category.',
        timestamp: '2026-09-11T10:00:00.000Z',
      },
    };

    const mockGraph = {
      invoke: jest.fn().mockResolvedValue(mockInvokeResult),
    };

    mockGraphFactory = {
      build: jest.fn().mockReturnValue(mockGraph),
    } as unknown as jest.Mocked<LeadValidatorGraphFactory>;

    service = new LeadValidatorService(
      mockGraphFactory,
      mockMediaPreprocessor,
      mockCatalogFetcher,
    );

    const report = await service.validateLead({
      ticketId: 'ticket-123',
      eventType: 'POST_YOUR_REQUIREMENT',
      userText: 'Need 3BHK interior renovation in Indiranagar',
      mediaUrls: ['https://example.com/drawing.jpg'],
      declaredCategory: 'Interior Design',
    });

    expect(report.status).toBe('MATCHED');
    expect(report.confidence_score).toBe(0.95);
    expect(report.matched_services).toHaveLength(1);
    expect(report.matched_services[0].service_name).toBe('Interior Works');
    expect(loggerLogSpy).toHaveBeenCalled();

    const loggedOutput = loggerLogSpy.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' && call[0].includes('"pipelineExecution"'),
    )?.[0];

    expect(loggedOutput).toBeDefined();

    const parsedJson = JSON.parse(loggedOutput.trim());

    expect(parsedJson).toEqual({
      ticketId: 'ticket-123',
      eventType: 'POST_YOUR_REQUIREMENT',
      timestamp: '2026-09-11T10:00:00.000Z',
      pipelineExecution: {
        stepA_TextModeration: {
          agentName: 'TextModeratorAgent',
          modelUsed: 'gpt-5-mini',
          purpose:
            'Screens profanity, physical feasibility, and BNM domain qualification',
          status: 'PASSED',
          analysis: {
            isClean: true,
            domainCategory: 'IN_SCOPE_LEGITIMATE',
            feasibilityScore: '9/10',
            intentSummary: 'Need 3BHK interior renovation in Indiranagar',
            profanitiesDetected: [],
            inferredCategory: 'Interior Design',
            reasoning: 'Standard interior service within BNM scope',
          },
        },
        stepB_VisionAnalysis: {
          agentName: 'VisionAnalystAgent',
          modelUsed: 'gpt-5-mini',
          purpose:
            'Verifies visual evidence against realistic property work sites and category reality',
          status: 'PASSED',
          analysis: {
            imagesProcessed: 1,
            detectedVisuals: ['living room with wooden TV unit'],
            isHomeServiceSiteOrPlan: true,
            isRealisticWorkSite: true,
            visualRelevance: 'RELEVANT',
            mismatchReason: null,
          },
        },
        stepC_FinalEvaluation: {
          agentName: 'EvaluatorAgent',
          purpose:
            'Consolidates findings from Step A and Step B to generate the final audit status',
          overallDecision: 'MATCHED',
          domainCategory: 'IN_SCOPE_LEGITIMATE',
          flagsRaised: [],
          summary:
            'User text and visual evidence perfectly align with declared Interior Design category.',
        },
      },
    });
  });

  it('should mark stepB_VisionAnalysis as SKIPPED when no mediaUrls are provided', async () => {
    const mockInvokeResult: LeadValidatorState = {
      ticketId: 'ticket-456',
      eventType: 'POST_YOUR_REQUIREMENTS',
      userText: 'Need deep house cleaning',
      mediaUrls: [],
      declaredCategory: 'Cleaning',
      textModelUsed: 'gpt-5-mini',
      visionModelUsed: 'gpt-5-mini',
      textModerationResult: {
        isClean: true,
        profanitiesOrViolations: [],
        domainCategory: 'IN_SCOPE_LEGITIMATE',
        inferredCategory: 'Cleaning',
        feasibilityScore: 8,
        intentSummary: 'Need deep house cleaning',
        reasoning: 'Cleaning service within BNM scope',
      },
      visionAnalysisResult: {
        detectedElements: [],
        isHomeServiceSiteOrPlan: true,
        isRealisticWorkSite: true,
        visualRelevance: 'RELEVANT',
        isImageRelevant: true,
        mismatchReason: null,
      },
      finalReport: {
        status: 'MATCHED',
        confidence_score: 0.9,
        analysis_stages: {
          stage_1_text_summary: {
            identified_intent: 'Need deep house cleaning',
            extracted_keywords: ['Cleaning'],
            text_validity: 'VALID',
          },
          stage_2_visual_summary: {
            total_images_analyzed: 0,
            image_breakdown: [],
            visual_consistency_verdict: 'IRRELEVANT',
          },
          stage_3_verification_notes: 'Clean text lead validated.',
        },
        matched_services: [],
        rejection_details: {
          is_rejected: false,
          reason_category: null,
          explanation: null,
        },
        recommended_action: 'ROUTE_TO_SERVICE',
        legacyStatus: 'APPROVED',
        flags: [],
        summary: 'Clean text lead validated.',
        timestamp: '2026-09-11T10:00:00.000Z',
      },
    };

    const mockGraph = {
      invoke: jest.fn().mockResolvedValue(mockInvokeResult),
    };

    mockGraphFactory = {
      build: jest.fn().mockReturnValue(mockGraph),
    } as unknown as jest.Mocked<LeadValidatorGraphFactory>;

    service = new LeadValidatorService(
      mockGraphFactory,
      mockMediaPreprocessor,
      mockCatalogFetcher,
    );

    await service.validateLead({
      ticketId: 'ticket-456',
      userText: 'Need deep house cleaning',
    });

    const loggedOutput = loggerLogSpy.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' && call[0].includes('"pipelineExecution"'),
    )?.[0];

    const parsedJson = JSON.parse(loggedOutput.trim());
    expect(parsedJson.pipelineExecution.stepB_VisionAnalysis.status).toBe(
      'SKIPPED',
    );
    expect(
      parsedJson.pipelineExecution.stepB_VisionAnalysis.analysis
        .imagesProcessed,
    ).toBe(0);
  });

  it('should combine extracted document content with userText and pass to graph', async () => {
    mockMediaPreprocessor.processAttachments.mockResolvedValueOnce({
      appendedText:
        '[PDF Document Content]:\nDetailed architectural specifications for 3BHK villa.',
      processedImages: ['data:image/jpeg;base64,/9j/4AAQSkZJRg=='],
    });

    let capturedGraphInput: any;
    const mockGraph = {
      invoke: jest.fn().mockImplementation(async (input: any) => {
        capturedGraphInput = input;
        return {
          ...input,
          finalReport: {
            status: 'MATCHED',
            confidence_score: 0.95,
            analysis_stages: {
              stage_1_text_summary: {
                identified_intent: 'Blueprint Villa review',
                extracted_keywords: ['Civil Construction'],
                text_validity: 'VALID',
              },
              stage_2_visual_summary: {
                total_images_analyzed: 1,
                image_breakdown: [
                  {
                    image_index: 1,
                    visual_evidence: 'Blueprint layout',
                    aligns_with_text: true,
                  },
                ],
                visual_consistency_verdict: 'CONSISTENT',
              },
              stage_3_verification_notes: 'Document lead processed',
            },
            matched_services: [],
            rejection_details: {
              is_rejected: false,
              reason_category: null,
              explanation: null,
            },
            recommended_action: 'ROUTE_TO_SERVICE',
            legacyStatus: 'APPROVED',
            flags: [],
            summary: 'Document lead processed',
            timestamp: '2026-09-11T10:00:00.000Z',
          },
        };
      }),
    };

    mockGraphFactory = {
      build: jest.fn().mockReturnValue(mockGraph),
    } as unknown as jest.Mocked<LeadValidatorGraphFactory>;

    service = new LeadValidatorService(
      mockGraphFactory,
      mockMediaPreprocessor,
      mockCatalogFetcher,
    );

    await service.validateLead({
      ticketId: 'doc-ticket',
      userText: 'Please review my attached blueprint',
      mediaUrls: [
        'https://example.com/blueprint.pdf',
        'https://example.com/site.heic',
      ],
    });

    expect(capturedGraphInput.userText).toBe(
      'Please review my attached blueprint\n\n[Attached Document Content]:\n[PDF Document Content]:\nDetailed architectural specifications for 3BHK villa.',
    );
    expect(capturedGraphInput.mediaUrls).toEqual([
      'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    ]);
    expect(capturedGraphInput.declaredCategory).toBe('Unspecified');
  });

  it('should handle pipeline errors gracefully and output fallback structured log', async () => {
    const mockGraph = {
      invoke: jest.fn().mockRejectedValue(new Error('Graph timeout')),
    };

    mockGraphFactory = {
      build: jest.fn().mockReturnValue(mockGraph),
    } as unknown as jest.Mocked<LeadValidatorGraphFactory>;

    service = new LeadValidatorService(
      mockGraphFactory,
      mockMediaPreprocessor,
      mockCatalogFetcher,
    );

    const report = await service.validateLead({
      ticketId: 'err-ticket',
      userText: 'Test error',
    });

    expect(report.status).toBe('PARTIAL_MATCH');

    const loggedOutput = loggerLogSpy.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' && call[0].includes('"pipelineExecution"'),
    )?.[0];

    expect(loggedOutput).toBeDefined();
    const parsed = JSON.parse(loggedOutput.trim());
    expect(parsed.ticketId).toBe('err-ticket');
    expect(parsed.pipelineExecution.stepC_FinalEvaluation.overallDecision).toBe(
      'PARTIAL_MATCH',
    );
  });

  it('should consolidate properly in stepC_FinalEvaluation with flagsRaised and PARTIAL_MATCH when Step A passes but Step B flags an unrelated car image', async () => {
    const mockInvokeResult: LeadValidatorState = {
      ticketId: 'ticket-car-lead',
      eventType: 'POST_YOUR_REQUIREMENT',
      userText: 'Need 3 rooms painted in white emulsion',
      mediaUrls: ['https://example.com/car.jpg'],
      declaredCategory: 'Painting',
      textModelUsed: 'gpt-5-mini',
      visionModelUsed: 'gpt-5-mini',
      textModerationResult: {
        isClean: true,
        profanitiesOrViolations: [],
        domainCategory: 'IN_SCOPE_LEGITIMATE',
        inferredCategory: 'Painting',
        feasibilityScore: 9,
        intentSummary: 'Painting request for 3 rooms',
        reasoning: 'Genuine painting requirement',
      },
      visionAnalysisResult: {
        detectedElements: ['red sports car'],
        isHomeServiceSiteOrPlan: false,
        isRealisticWorkSite: false,
        visualRelevance: 'MISMATCHED',
        isImageRelevant: false,
        mismatchReason: 'Image depicts a car, not a painting work site',
      },
      finalReport: {
        status: 'PARTIAL_MATCH',
        confidence_score: 0.65,
        analysis_stages: {
          stage_1_text_summary: {
            identified_intent: 'Painting request for 3 rooms',
            extracted_keywords: ['Painting'],
            text_validity: 'VALID',
          },
          stage_2_visual_summary: {
            total_images_analyzed: 1,
            image_breakdown: [
              {
                image_index: 1,
                visual_evidence: 'red sports car',
                aligns_with_text: false,
              },
            ],
            visual_consistency_verdict: 'CONFLICTING',
          },
          stage_3_verification_notes:
            'Request overlaps with catalog scope but requires clarification. Flags: NON_WORK_SITE_IMAGE: Image depicts a car, not a painting work site',
        },
        matched_services: [
          {
            service_id: '33941d44-41df-4d92-b7e1-24a3fb4c7cb4',
            service_name: 'Painting',
            category: 'Painting',
            relevance_score: 0.75,
            matching_justification: 'Overlaps with Painting catalog service',
          },
        ],
        rejection_details: {
          is_rejected: false,
          reason_category: null,
          explanation: null,
        },
        recommended_action: 'REQUIRE_CLARIFICATION',
        legacyStatus: 'FLAGGED_FOR_REVIEW',
        flags: ['NON_WORK_SITE_IMAGE: Image depicts a car, not a painting work site'],
        summary:
          'Request overlaps with catalog scope but requires clarification. Flags: NON_WORK_SITE_IMAGE: Image depicts a car, not a painting work site',
        timestamp: '2026-09-22T10:00:00.000Z',
      },
    };

    const mockGraph = {
      invoke: jest.fn().mockResolvedValue(mockInvokeResult),
    };

    mockGraphFactory = {
      build: jest.fn().mockReturnValue(mockGraph),
    } as unknown as jest.Mocked<LeadValidatorGraphFactory>;

    service = new LeadValidatorService(
      mockGraphFactory,
      mockMediaPreprocessor,
      mockCatalogFetcher,
    );

    const report = await service.validateLead({
      ticketId: 'ticket-car-lead',
      eventType: 'POST_YOUR_REQUIREMENT',
      userText: 'Need 3 rooms painted in white emulsion',
      mediaUrls: ['https://example.com/car.jpg'],
      declaredCategory: 'Painting',
    });

    expect(report.status).toBe('PARTIAL_MATCH');
    expect(report.recommended_action).toBe('REQUIRE_CLARIFICATION');
    expect(report.flags).toContain(
      'NON_WORK_SITE_IMAGE: Image depicts a car, not a painting work site',
    );

    const loggedOutput = loggerLogSpy.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('"ticketId": "ticket-car-lead"'),
    )?.[0];

    expect(loggedOutput).toBeDefined();
    const parsed = JSON.parse(loggedOutput.trim());

    // Step A passed
    expect(parsed.pipelineExecution.stepA_TextModeration.status).toBe('PASSED');

    // Step B flagged because car image is not a realistic work site
    expect(parsed.pipelineExecution.stepB_VisionAnalysis.status).toBe('FLAGGED');
    expect(
      parsed.pipelineExecution.stepB_VisionAnalysis.analysis.isRealisticWorkSite,
    ).toBe(false);

    // Step C consolidated: MUST NOT be MATCHED, MUST have flagsRaised
    expect(parsed.pipelineExecution.stepC_FinalEvaluation.overallDecision).toBe(
      'PARTIAL_MATCH',
    );
    expect(parsed.pipelineExecution.stepC_FinalEvaluation.flagsRaised).toContain(
      'NON_WORK_SITE_IMAGE: Image depicts a car, not a painting work site',
    );
  });
});

