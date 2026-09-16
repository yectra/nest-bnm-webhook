import { LeadValidatorService } from './lead-validator.service';
import { LeadValidatorGraphFactory } from './lead-validator-graph.factory';
import { LeadValidatorState } from './lead-validator.types';
import { MediaPreprocessorService } from './services/media-preprocessor.service';
import { Logger } from '@nestjs/common';

describe('LeadValidatorService', () => {
  let service: LeadValidatorService;
  let mockGraphFactory: jest.Mocked<LeadValidatorGraphFactory>;
  let mockMediaPreprocessor: jest.Mocked<MediaPreprocessorService>;
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
        status: 'APPROVED',
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

    service = new LeadValidatorService(mockGraphFactory, mockMediaPreprocessor);

    const report = await service.validateLead({
      ticketId: 'ticket-123',
      eventType: 'POST_YOUR_REQUIREMENT',
      userText: 'Need 3BHK interior renovation in Indiranagar',
      mediaUrls: ['https://example.com/drawing.jpg'],
      declaredCategory: 'Interior Design',
    });

    expect(report.status).toBe('APPROVED');
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
          overallDecision: 'APPROVED',
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
        status: 'APPROVED',
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

    service = new LeadValidatorService(mockGraphFactory, mockMediaPreprocessor);

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
      invoke: jest.fn().mockImplementation(async (input) => {
        capturedGraphInput = input;
        return {
          ticketId: input.ticketId,
          eventType: input.eventType,
          userText: input.userText,
          mediaUrls: input.mediaUrls,
          declaredCategory: input.declaredCategory,
          finalReport: {
            status: 'APPROVED',
            flags: [],
            summary: 'Valid lead with document',
            timestamp: new Date().toISOString(),
          },
        };
      }),
    };

    mockGraphFactory = {
      build: jest.fn().mockReturnValue(mockGraph),
    } as unknown as jest.Mocked<LeadValidatorGraphFactory>;

    service = new LeadValidatorService(mockGraphFactory, mockMediaPreprocessor);

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

    service = new LeadValidatorService(mockGraphFactory, mockMediaPreprocessor);

    const report = await service.validateLead({
      ticketId: 'err-ticket',
      userText: 'Test error',
    });

    expect(report.status).toBe('FLAGGED_FOR_REVIEW');

    const loggedOutput = loggerLogSpy.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' && call[0].includes('"pipelineExecution"'),
    )?.[0];

    expect(loggedOutput).toBeDefined();
    const parsed = JSON.parse(loggedOutput.trim());
    expect(parsed.ticketId).toBe('err-ticket');
    expect(parsed.pipelineExecution.stepC_FinalEvaluation.overallDecision).toBe(
      'FLAGGED_FOR_REVIEW',
    );
  });
});
