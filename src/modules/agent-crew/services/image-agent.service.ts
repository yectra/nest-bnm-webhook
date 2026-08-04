import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SqlParameter } from '@azure/cosmos';
import { CosmosRepository } from '../../chatbot/repositories/cosmos.repository';
import { CrewLlmProvider } from './crew-llm.provider';
import { CrewImageInsight } from '../interfaces/crew.interfaces';
import { CrewAgentDefinition } from '../graph/crew-agent.definition';
import { CrewState, traceEntry } from '../graph/crew-state';
import { buildImageAnalysisPrompt } from '../prompts/crew.prompts';

const IMAGE_KEYWORDS =
  /\b(picture|pictures|photo|photos|image|images|attachment|attachments|drawing|drawings|screenshot|requirement form|post your requirements?)\b/i;

const IMAGE_FIELD_NAMES = [
  'images',
  'imageUrls',
  'imageUrl',
  'pictures',
  'pictureUrls',
  'photos',
  'photoUrls',
  'photoUrl',
  'attachments',
  'attachmentUrls',
];

interface DiscoveredImage {
  url: string;
  sourceContainer: string;
  sourceId: string;
}

/**
 * Vision agent: collects picture URLs attached to the user's Quote and
 * Post Your Requirements documents, then summarizes each with GPT-5 vision.
 */
@Injectable()
export class ImageAgentService implements CrewAgentDefinition {
  readonly name = 'imageAgent';
  readonly planKey = 'useImages';
  readonly planningHint =
    'analyze pictures attached to quotes or Post Your Requirements forms; ' +
    'true when the question mentions pictures, photos, images, attachments, ' +
    'or drawings';

  private readonly logger = new Logger(ImageAgentService.name);
  private readonly quoteContainer: string;
  private readonly requirementsContainer: string;
  private readonly maxImages: number;
  private readonly isEnabled: boolean;
  private readonly imageModel: string;

  constructor(
    private readonly cosmosRepository: CosmosRepository,
    private readonly llm: CrewLlmProvider,
    config: ConfigService,
  ) {
    this.quoteContainer =
      config.get<string>('AGENT_CREW_QUOTE_CONTAINER') ?? 'Quote';
    this.requirementsContainer =
      config.get<string>('AGENT_CREW_REQUIREMENTS_CONTAINER') ??
      'PostYourRequirements';
    this.maxImages = config.get<number>('AGENT_CREW_MAX_IMAGES') ?? 4;
    const flag = config.get<boolean | string>('AGENT_CREW_IMAGE_AGENT_ENABLED');
    this.isEnabled = flag === true || flag === 'true';
    this.imageModel =
      config.get<string>('OPENAI_IMAGE_MODEL') ??
      'gpt-5-nano';
  }

  /** Picture analysis is opt-in: off unless AGENT_CREW_IMAGE_AGENT_ENABLED=true. */
  enabled(): boolean {
    return this.isEnabled;
  }

  planHeuristic(question: string): boolean {
    return IMAGE_KEYWORDS.test(question);
  }

  async run(state: CrewState): Promise<Partial<CrewState>> {
    const imageInsights = await this.analyze(state.question, state.userId);
    return {
      imageInsights,
      trace: [
        traceEntry(
          this.name,
          `analyzed ${imageInsights.length} attached pictures`,
        ),
      ],
    };
  }

  async analyze(
    question: string,
    userId?: string,
  ): Promise<CrewImageInsight[]> {
    const discovered = await this.discoverImages(userId);
    if (discovered.length === 0) {
      this.logger.log(
        'Image agent: no pictures found on quotes or requirement forms',
      );
      return [];
    }

    const limited = discovered.slice(0, this.maxImages);
    this.logger.log(
      `Image agent: analyzing ${limited.length}/${discovered.length} discovered pictures with GPT-5 vision`,
    );

    const insights = await Promise.all(
      limited.map(async (image) => {
        try {
          const summary = await this.llm.describeImage(
            buildImageAnalysisPrompt(image.sourceContainer, question),
            image.url,
            this.imageModel,
          );
          if (!summary) {
            return null;
          }
          return {
            url: image.url,
            sourceContainer: image.sourceContainer,
            sourceId: image.sourceId,
            summary,
          } satisfies CrewImageInsight;
        } catch (error) {
          this.logger.warn(
            `Image agent: vision analysis failed for ${image.sourceContainer}/${image.sourceId}`,
            error,
          );
          return null;
        }
      }),
    );

    return insights.filter((insight): insight is CrewImageInsight =>
      Boolean(insight),
    );
  }

  private async discoverImages(userId?: string): Promise<DiscoveredImage[]> {
    const [quoteImages, requirementImages] = await Promise.all([
      this.collectFromContainer(this.quoteContainer, userId),
      this.collectFromContainer(this.requirementsContainer, userId),
    ]);

    const seen = new Set<string>();
    const unique: DiscoveredImage[] = [];
    for (const image of [...quoteImages, ...requirementImages]) {
      if (!seen.has(image.url)) {
        seen.add(image.url);
        unique.push(image);
      }
    }
    return unique;
  }

  private async collectFromContainer(
    containerName: string,
    userId?: string,
  ): Promise<DiscoveredImage[]> {
    const parameters: SqlParameter[] = [];
    let userCondition = '1=1';
    if (userId) {
      userCondition = '(c.userId = @userId OR c.ownerUserId = @userId)';
      parameters.push({ name: '@userId', value: userId });
    }

    const query = `
      SELECT TOP 10 c
      FROM c
      WHERE ${userCondition}
      ORDER BY c._ts DESC
    `;

    const rows = await this.cosmosRepository.queryVector<{
      c: Record<string, unknown>;
    }>(containerName, query, parameters);

    const images: DiscoveredImage[] = [];
    for (const { c } of rows) {
      const sourceId = typeof c.id === 'string' ? c.id : 'unknown';
      for (const url of this.extractImageUrls(c)) {
        images.push({ url, sourceContainer: containerName, sourceId });
      }
    }
    return images;
  }

  /** Pull image URLs out of the common attachment field shapes. */
  private extractImageUrls(document: Record<string, unknown>): string[] {
    const urls: string[] = [];

    const addCandidate = (value: unknown) => {
      if (typeof value === 'string' && this.isImageUrl(value)) {
        urls.push(value);
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>;
        addCandidate(nested.url ?? nested.contentUrl ?? nested.href);
      }
    };

    for (const field of IMAGE_FIELD_NAMES) {
      const value = document[field];
      if (Array.isArray(value)) {
        value.forEach(addCandidate);
      } else {
        addCandidate(value);
      }
    }
    return urls;
  }

  private isImageUrl(value: string): boolean {
    if (value.startsWith('data:image/')) {
      return true;
    }
    if (!/^https?:\/\//i.test(value)) {
      return false;
    }
    // Accept common image extensions or blob-storage style URLs without one.
    return (
      /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(value) ||
      /blob\.core\.windows\.net/i.test(value)
    );
  }
}
