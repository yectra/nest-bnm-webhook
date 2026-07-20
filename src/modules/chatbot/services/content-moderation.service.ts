import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

/**
 * Service that checks user‑generated content against Azure OpenAI's moderation endpoint.
 * Returns `true` when the content is flagged (i.e., contains disallowed material).
 */
@Injectable()
export class ContentModerationService {
  private readonly client: OpenAI;
  private readonly logger = new Logger(ContentModerationService.name);

  constructor(private readonly config: ConfigService) {
    // Retrieve Azure OpenAI configuration. If any required value is missing we fall back to a no‑op client
    // that will simply return `false` for moderation checks. This prevents a hard 404 crash when the
    // deployment name or endpoint is not configured (common in local development).
    const baseURL = this.config.get<string>('OPENAI_BASE_URL');
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    const deployment = this.config.get<string>('OPENAI_MODERATION_DEPLOYMENT');

    if (baseURL && apiKey && deployment) {
      this.client = new OpenAI({
        baseURL,
        apiKey,
      });
      // Store the deployment name for later use; the OpenAI SDK expects the model field to be the
      // deployment identifier when targeting Azure OpenAI.
      this.moderationDeployment = deployment;
    } else {
      // Create a dummy client that satisfies the type but will never be called.
      // The `as any` cast is safe because we guard usage in `isFlagged`.
      this.client = {} as any;
      this.moderationDeployment = undefined;
      this.logger.warn(
        'OpenAI moderation configuration missing (BASE_URL, API_KEY, or DEPLOYMENT). Moderation will be disabled.',
      );
    }
  }

  // Holds the Azure OpenAI deployment name for the moderation model, if configured.
  private readonly moderationDeployment?: string;

  /**
   * Calls the moderation endpoint. Returns `true` if any category is flagged.
   */
  async isFlagged(content: string): Promise<boolean> {
    try {
      // If the client is not properly configured we skip moderation.
      if (!this.moderationDeployment) {
        return false;
      }

      const response = await this.client.moderations.create({
        input: content,
        // Azure OpenAI expects the deployment name here.
        model: this.moderationDeployment,
      });
      return response?.results?.[0]?.flagged ?? false;
    } catch (e) {
      this.logger.error('Content moderation failed', e);
      // In case of error, treat as not flagged to avoid blocking legitimate traffic.
      return false;
    }
  }
}
