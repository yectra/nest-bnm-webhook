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
    const modelUsed = this.llm.getImageModelName();
    this.logger.log(`[AI MODEL] stage=image model=${modelUsed}`);

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
      const userPrompt = `Declared Category: "${state.declaredCategory || 'None provided'}"
User Requirement Text: "${state.userText || 'None provided'}"

Analyze the visual evidence in this image against Brick N Mortar home-service reality and the declared category, then return the JSON.`;

      const imageResults = await Promise.all(
        urlsToProcess.map(async (url, index) => {
          try {
            const result = await this.llm.completeMultiModalJson<VisionAnalysisResult>(
              VISION_ANALYST_SYSTEM_PROMPT,
              userPrompt,
              [url],
              modelUsed,
              {
                requestId: state.ticketId,
                stage: 'image',
                process: 'vision_analysis',
                modelEnv: 'OPENAI_IMAGE_MODEL',
                callIndex: index + 1,
              },
            );
            if (!result) {
              throw new Error(`Failed to parse JSON for image ${index + 1}`);
            }
            return result;
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            this.logger.warn(`Failed to process image ${url}: ${message}`);
            return null;
          }
        }),
      );

      const validResults = imageResults.filter(
        (r): r is VisionAnalysisResult => r !== null,
      );

      if (validResults.length === 0) {
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

      const allDetectedElements = Array.from(
        new Set(validResults.flatMap((r) => r.detectedElements || [])),
      );
      const isHomeServiceSiteOrPlan = validResults.every(
        (r) => r.isHomeServiceSiteOrPlan ?? true,
      );
      const isRealisticWorkSite = validResults.every(
        (r) => r.isRealisticWorkSite ?? true,
      );

      let visualRelevance: 'RELEVANT' | 'MISMATCHED' | 'ABSURD_OR_UNFEASIBLE' =
        'RELEVANT';
      if (validResults.some((r) => r.visualRelevance === 'ABSURD_OR_UNFEASIBLE')) {
        visualRelevance = 'ABSURD_OR_UNFEASIBLE';
      } else if (validResults.some((r) => r.visualRelevance === 'MISMATCHED')) {
        visualRelevance = 'MISMATCHED';
      }

      const mismatchReasons = validResults
        .map((r) => r.mismatchReason)
        .filter(
          (r): r is string => Boolean(r && r.trim().length > 0 && r !== 'None'),
        );

      const normalizedResult: VisionAnalysisResult = {
        detectedElements: allDetectedElements,
        isHomeServiceSiteOrPlan,
        isRealisticWorkSite,
        visualRelevance,
        mismatchReason:
          mismatchReasons.length > 0 ? mismatchReasons.join('; ') : null,
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
