import { VisionAnalystNode } from './vision-analyst.node';
import { CrewLlmProvider } from '../../services/crew-llm.provider';
import { LeadValidatorState } from '../lead-validator.types';
import { AiUsageTelemetryService } from '../../../../common/telemetry/ai-usage-telemetry.service';

describe('VisionAnalystNode', () => {
  let mockLlm: jest.Mocked<CrewLlmProvider>;
  let mockTelemetry: jest.Mocked<AiUsageTelemetryService>;
  let node: VisionAnalystNode;

  beforeEach(() => {
    mockLlm = {
      getImageModelName: jest.fn().mockReturnValue('gpt-5-mini'),
      completeMultiModalJson: jest.fn(),
      completeJson: jest.fn(),
      completeText: jest.fn(),
    } as unknown as jest.Mocked<CrewLlmProvider>;

    mockTelemetry = {
      recordUsage: jest.fn(),
      getStageUsage: jest.fn(),
      getSummaryReport: jest.fn(),
      emitSummary: jest.fn(),
    } as unknown as jest.Mocked<AiUsageTelemetryService>;

    node = new VisionAnalystNode(mockLlm, mockTelemetry);
  });

  it('should process 1 image with exactly 1 multimodal vision AI call', async () => {
    mockLlm.completeMultiModalJson.mockResolvedValueOnce({
      detectedElements: ['wooden dining table', 'chair'],
      isHomeServiceSiteOrPlan: true,
      isRealisticWorkSite: true,
      visualRelevance: 'RELEVANT',
      isImageRelevant: true,
      mismatchReason: null,
    });

    const state: LeadValidatorState = {
      ticketId: 'test-ticket-1',
      userText: 'Need wooden dining table repair',
      declaredCategory: 'Carpentry',
      mediaUrls: ['https://example.com/table.jpg'],
    };

    const result = await node.run(state);

    // Verify 1 image = exactly 1 multimodal call
    expect(mockLlm.completeMultiModalJson).toHaveBeenCalledTimes(1);
    expect(mockLlm.completeJson).not.toHaveBeenCalled();
    expect(mockLlm.completeText).not.toHaveBeenCalled();

    // Verify correct VisionAnalysisResult output
    expect(result.visionAnalysisResult).toBeDefined();
    expect(result.visionAnalysisResult?.detectedElements).toEqual([
      'wooden dining table',
      'chair',
    ]);
    expect(result.visionAnalysisResult?.isHomeServiceSiteOrPlan).toBe(true);
    expect(result.visionAnalysisResult?.isRealisticWorkSite).toBe(true);
    expect(result.visionAnalysisResult?.visualRelevance).toBe('RELEVANT');
    expect(result.visionAnalysisResult?.isImageRelevant).toBe(true);
  });

  it('should process N images with exactly N multimodal calls (1 per image)', async () => {
    mockLlm.completeMultiModalJson
      .mockResolvedValueOnce({
        detectedElements: ['living room sofa'],
        isHomeServiceSiteOrPlan: true,
        isRealisticWorkSite: true,
        visualRelevance: 'RELEVANT',
        isImageRelevant: true,
        mismatchReason: null,
      })
      .mockResolvedValueOnce({
        detectedElements: ['wall paint peeling'],
        isHomeServiceSiteOrPlan: true,
        isRealisticWorkSite: true,
        visualRelevance: 'RELEVANT',
        isImageRelevant: true,
        mismatchReason: null,
      });

    const state: LeadValidatorState = {
      ticketId: 'test-ticket-2',
      userText: 'Need living room painting',
      declaredCategory: 'Painting',
      mediaUrls: [
        'https://example.com/sofa.jpg',
        'https://example.com/wall.jpg',
      ],
    };

    const result = await node.run(state);

    // 2 images = 2 multimodal calls
    expect(mockLlm.completeMultiModalJson).toHaveBeenCalledTimes(2);
    expect(mockLlm.completeJson).not.toHaveBeenCalled();

    expect(result.visionAnalysisResult?.detectedElements).toEqual([
      'living room sofa',
      'wall paint peeling',
    ]);
    expect(result.visionAnalysisResult?.visualRelevance).toBe('RELEVANT');
  });

  it('should return default fallback when no mediaUrls are provided', async () => {
    const state: LeadValidatorState = {
      ticketId: 'test-ticket-3',
      userText: 'Cleaning service',
      declaredCategory: 'Cleaning',
      mediaUrls: [],
    };

    const result = await node.run(state);

    expect(mockLlm.completeMultiModalJson).not.toHaveBeenCalled();
    expect(result.visionAnalysisResult).toEqual({
      detectedElements: [],
      isHomeServiceSiteOrPlan: true,
      isRealisticWorkSite: true,
      visualRelevance: 'RELEVANT',
      isImageRelevant: true,
      mismatchReason: null,
    });
  });

  it('should handle image call failures gracefully without crashing', async () => {
    mockLlm.completeMultiModalJson.mockRejectedValueOnce(
      new Error('Azure OpenAI Timeout'),
    );

    const state: LeadValidatorState = {
      ticketId: 'test-ticket-4',
      userText: 'Plumbing repair',
      declaredCategory: 'Plumbing',
      mediaUrls: ['https://example.com/pipe.jpg'],
    };

    const result = await node.run(state);

    expect(mockLlm.completeMultiModalJson).toHaveBeenCalledTimes(1);
    expect(result.visionAnalysisResult?.visualRelevance).toBe('RELEVANT');
    expect(result.visionAnalysisResult?.detectedElements).toEqual([
      'Inaccessible or private image URL',
    ]);
  });
});
