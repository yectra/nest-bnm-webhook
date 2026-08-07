import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrewLlmProvider } from '../../agent-crew/services/crew-llm.provider';
import { WhatsappInboundMessage } from '../../whatsapp/interfaces/whatsapp-message.interface';
import { WhatsappMediaInsight } from '../interfaces/whatsapp-crew.interfaces';
import { buildInboundImagePrompt } from '../prompts/whatsapp-crew.prompts';

export interface MediaIntakeResult {
  question: string;
  mediaInsights: WhatsappMediaInsight[];
}

/**
 * Intake node: turns any inbound WhatsApp message — whatever its type — into
 * text the rest of the crew can reason over. Pictures are described with the
 * vision model; locations, contacts, button/list replies, voice notes,
 * videos, documents, stickers, and reactions become deterministic summaries.
 * The combined text becomes the crew's working "question".
 */
@Injectable()
export class MediaIntakeService {
  private readonly logger = new Logger(MediaIntakeService.name);
  private readonly imageModel: string;
  private readonly maxImages: number;

  constructor(
    private readonly llm: CrewLlmProvider,
    config: ConfigService,
  ) {
    this.imageModel = config.get<string>('OPENAI_IMAGE_MODEL') ?? 'gpt-5-nano';
    this.maxImages = config.get<number>('AGENT_CREW_MAX_IMAGES') ?? 4;
  }

  async intake(message: WhatsappInboundMessage): Promise<MediaIntakeResult> {
    const insights: WhatsappMediaInsight[] = [];

    switch (message.messageType) {
      case 'image':
      case 'sticker':
        insights.push(...(await this.analyzeImages(message)));
        break;
      case 'video':
        insights.push(
          ...message.media.map((item) => ({
            kind: 'video',
            summary:
              'Customer sent a video. Video content could not be analyzed automatically; ask for key details as text if needed.',
            url: item.url,
            contentType: item.contentType,
          })),
        );
        break;
      case 'audio':
      case 'voice':
        insights.push(
          ...message.media.map((item) => ({
            kind: 'voice note',
            summary:
              'Customer sent a voice note. Audio transcription is not available; acknowledge it and ask them to share the key details as text.',
            url: item.url,
            contentType: item.contentType,
          })),
        );
        break;
      case 'document':
        insights.push(
          ...message.media.map((item) => ({
            kind: 'document',
            summary: `Customer attached a document (${item.contentType || 'unknown type'}). Its contents could not be read automatically.`,
            url: item.url,
            contentType: item.contentType,
          })),
        );
        break;
      case 'location':
        if (message.location) {
          const parts = [
            `latitude ${message.location.latitude}`,
            `longitude ${message.location.longitude}`,
          ];
          if (message.location.label)
            parts.push(`label "${message.location.label}"`);
          if (message.location.address)
            parts.push(`address "${message.location.address}"`);
          insights.push({
            kind: 'location',
            summary: `Customer shared a location: ${parts.join(', ')}.`,
          });
        }
        break;
      case 'contacts':
        insights.push({
          kind: 'contacts',
          summary:
            'Customer shared one or more contact cards, likely someone to reach or refer.',
        });
        break;
      case 'button':
        insights.push({
          kind: 'button reply',
          summary: `Customer tapped the button "${message.buttonText ?? message.buttonPayload ?? ''}" in reply to an earlier message.`,
        });
        break;
      case 'interactive':
        insights.push({
          kind: 'list reply',
          summary: `Customer selected "${message.interactiveReply?.title ?? message.interactiveReply?.id ?? ''}" from an interactive list.`,
        });
        break;
      case 'reaction':
        insights.push({
          kind: 'reaction',
          summary: `Customer reacted with "${message.body}" to an earlier message.`,
        });
        break;
      default:
        break;
    }

    return {
      question: this.composeQuestion(message, insights),
      mediaInsights: insights,
    };
  }

  private async analyzeImages(
    message: WhatsappInboundMessage,
  ): Promise<WhatsappMediaInsight[]> {
    const images = message.media.slice(0, this.maxImages);
    const insights = await Promise.all(
      images.map(async (item) => {
        try {
          const summary = await this.llm.describeImage(
            buildInboundImagePrompt(message.body),
            item.url,
            this.imageModel,
          );
          return {
            kind: message.messageType === 'sticker' ? 'sticker' : 'picture',
            summary:
              summary ||
              'Customer sent a picture that could not be analyzed automatically.',
            url: item.url,
            contentType: item.contentType,
          };
        } catch (error) {
          this.logger.warn(
            `Vision analysis failed for inbound media ${item.url}`,
            error,
          );
          return {
            kind: 'picture',
            summary:
              'Customer sent a picture that could not be analyzed automatically.',
            url: item.url,
            contentType: item.contentType,
          };
        }
      }),
    );
    return insights;
  }

  /** Body text plus media understanding, as one retrievable question. */
  private composeQuestion(
    message: WhatsappInboundMessage,
    insights: WhatsappMediaInsight[],
  ): string {
    const parts: string[] = [];
    const body = message.body?.trim();

    if (message.messageType === 'button') {
      parts.push(message.buttonText || message.buttonPayload || body || '');
    } else if (message.messageType === 'interactive') {
      parts.push(
        message.interactiveReply?.title ||
          message.interactiveReply?.id ||
          body ||
          '',
      );
    } else if (body) {
      parts.push(body);
    }

    for (const insight of insights) {
      parts.push(`[${insight.kind}] ${insight.summary}`);
    }

    const question = parts.filter(Boolean).join('\n').trim();
    return question || `Customer sent a ${message.messageType} message.`;
  }
}
