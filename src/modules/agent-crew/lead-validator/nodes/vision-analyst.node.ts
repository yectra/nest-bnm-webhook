import { Injectable, Logger } from '@nestjs/common';
import { CrewLlmProvider } from '../../services/crew-llm.provider';
import {
  LeadValidatorState,
  VisionAnalysisResult,
} from '../lead-validator.types';
import { VISION_ANALYST_SYSTEM_PROMPT } from '../prompts/validator.prompts';

@Injectable()
export class VisionAnalystNode {
  private readonly logger = new Logger(VisionAnalystNode.name);

  constructor(private readonly llm: CrewLlmProvider) {}

  async run(state: LeadValidatorState): Promise<Partial<LeadValidatorState>> {
    this.logger.debug(
      `Running VisionAnalystNode for Ticket: ${state.ticketId}`,
    );
    const modelUsed = this.llm.getModerationModelName();

    if (!state.mediaUrls || state.mediaUrls.length === 0) {
      return {
        visionAnalysisResult: {
          detectedElements: [],
          isHomeServiceSiteOrPlan: true,
          isRealisticWorkSite: true,
          visualRelevance: 'RELEVANT',
          mismatchReason: null,
          isImageRelevant: true,
        },
        visionModelUsed: modelUsed,
      };
    }

    // Process up to 4 images in parallel
    const maxImages = Math.min(state.mediaUrls.length, 4);
    const urlsToProcess = state.mediaUrls.slice(0, maxImages);

    try {
      const imageDescriptions = await Promise.all(
        urlsToProcess.map(async (url, index) => {
          try {
            const description = await this.llm.describeImage(
              `Describe what is happening in this image. Is it relevant to residential/commercial construction, interior design, or home services?`,
              url,
              modelUsed,
            );
            return `Image ${index + 1}: ${description}`;
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            this.logger.warn(`Failed to process image ${url}: ${message}`);
            return `Image ${index + 1}: Failed to load or analyze.`;
          }
        }),
      );

      const allFailed = imageDescriptions.every((desc) =>
        desc.includes('Failed to load or analyze'),
      );

      if (allFailed) {
        this.logger.warn(
          `All images for ticket ${state.ticketId} failed to load or are private blobs inaccessible to Azure OpenAI. Skipping image penalty.`,
        );
        return {
          visionAnalysisResult: {
            detectedElements: ['Inaccessible or private image URL'],
            isHomeServiceSiteOrPlan: true,
            isRealisticWorkSite: true,
            visualRelevance: 'RELEVANT',
            mismatchReason: null,
            isImageRelevant: true,
          },
          visionModelUsed: modelUsed,
        };
      }

      const aggregatedDescriptions = imageDescriptions.join('\n\n');

      const userPrompt = `
Declared Category: "${state.declaredCategory || 'None provided'}"

Image Descriptions:
${aggregatedDescriptions}

Analyze the visual evidence against Brick N Mortar home-service reality and the declared category, then return the JSON.`;

      const result = await this.llm.completeJson<VisionAnalysisResult>(
        VISION_ANALYST_SYSTEM_PROMPT,
        userPrompt,
        modelUsed,
      );

      if (!result) {
        throw new Error('LLM returned null or failed to parse JSON');
      }

      const visualRelevance = result.visualRelevance || 'RELEVANT';
      const normalizedResult: VisionAnalysisResult = {
        detectedElements: result.detectedElements || [],
        isHomeServiceSiteOrPlan: result.isHomeServiceSiteOrPlan ?? true,
        isRealisticWorkSite: result.isRealisticWorkSite ?? true,
        visualRelevance,
        mismatchReason: result.mismatchReason || null,
        isImageRelevant: visualRelevance === 'RELEVANT',
      };

      return {
        visionAnalysisResult: normalizedResult,
        visionModelUsed: modelUsed,
      };
    } catch (error: unknown) {
      const errMessage = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Vision Analysis failed: ${errMessage}`, errStack);

      // Fallback response
      return {
        visionAnalysisResult: {
          detectedElements: ['Error analyzing images'],
          isHomeServiceSiteOrPlan: true,
          isRealisticWorkSite: true,
          visualRelevance: 'RELEVANT',
          mismatchReason: 'Analysis error, proceeding with caution.',
          isImageRelevant: true,
        },
        visionModelUsed: modelUsed,
      };
    }
  }
}
