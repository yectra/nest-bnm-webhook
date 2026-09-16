import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostYourRequirementsAgentService } from '../../whatsapp-agent/services/post-your-requirements-agent.service';
import { RequestAQuoteAgentService } from '../../whatsapp-agent/services/request-a-quote-agent.service';
import { LeadValidatorService } from '../../agent-crew/lead-validator/lead-validator.service';

export interface EventGridEvent<T = any> {
  id?: string;
  eventId?: string;
  eventType?: string;
  eventName?: string;
  subject?: string;
  eventTime?: string;
  eventTimestamp?: string;
  data?: T;
  payload?: T;
  topic?: string;
  dataVersion?: string;
  metadataVersion?: string;
}

export interface SubscriptionValidationData {
  validationCode: string;
  validationUrl?: string;
}

@Injectable()
export class EventGridService {
  private readonly logger = new Logger(EventGridService.name);

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject(forwardRef(() => PostYourRequirementsAgentService))
    private readonly postYourRequirementsAgentService?: PostYourRequirementsAgentService,
    @Optional()
    @Inject(forwardRef(() => RequestAQuoteAgentService))
    private readonly requestAQuoteAgentService?: RequestAQuoteAgentService,
    @Optional() private readonly leadValidatorService?: LeadValidatorService,
  ) {}

  async processEvent(payload: EventGridEvent | EventGridEvent[]) {
    const events = Array.isArray(payload) ? payload : [payload];
    const results: any[] = [];

    for (const event of events) {
      const eventType = event?.eventType || event?.eventName || 'UNKNOWN_EVENT';
      const eventId = event?.id || event?.eventId || 'N/A';


      switch (eventType) {
        case 'Microsoft.EventGrid.SubscriptionValidationEvent': {
          // Handshake logic ONLY
          return this.handleSubscriptionValidation(event);
        }

        case 'POST_YOUR_REQUIREMENT':
        case 'POST_YOUR_REQUIREMENTS': {
          // 1. Fire-and-forget Lead Validator specifically for requirement leads
          this.triggerLeadValidator(event);

          // 2. Execute ONLY PostYourRequirementsAgentService
          if (this.postYourRequirementsAgentService?.processEvent) {
            const agentReply = await this.postYourRequirementsAgentService.processEvent(event);
            results.push({
              status: 'success',
              eventId,
              eventType,
              agentReply,
            });
          } else {
            results.push({
              status: 'success',
              eventId,
              eventType,
            });
          }
          break;
        }

        case 'QUOTE_CREATED_EVENT': {
          // 1. Fire-and-forget Lead Validator specifically for quotes
          this.triggerLeadValidator(event);

          // 2. Execute ONLY RequestAQuoteAgentService
          if (this.requestAQuoteAgentService?.processEvent) {
            const agentReply = await this.requestAQuoteAgentService.processEvent(event);
            results.push({
              status: 'success',
              eventId,
              eventType,
              agentReply,
            });
          } else {
            results.push({
              status: 'success',
              eventId,
              eventType,
            });
          }
          break;
        }

        case 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT': {
          // Trigger Lead Validator for incoming requirement data from Java backend
          this.triggerLeadValidator(event);

          // Handle ONLY WhatsApp event logic here.
          // DO NOT invoke RequestAQuoteAgent or PostYourRequirementsAgent!
          this.logger.log(`Processing WhatsApp event: ${eventId}`);
          results.push({
            status: 'success',
            eventId,
            eventType,
          });
          break;
        }

        default: {
          this.logger.warn(`No dedicated handler registered for eventType: ${eventType}`);
          results.push({
            status: 'ignored',
            eventId,
            eventType,
          });
          break;
        }
      }
    }

    return {
      message: 'Event Grid payload processed successfully',
      processedCount: events.length,
      results,
    };
  }

  private handleSubscriptionValidation(event: EventGridEvent): { validationResponse: string } {
    const validationData = (event.data || event.payload) as SubscriptionValidationData;
    const validationCode = validationData?.validationCode;

    this.logger.log(
      `[Azure Event Grid] Subscription validation handshake received. Code: ${validationCode}`,
    );

    return { validationResponse: validationCode };
  }

  private triggerLeadValidator(event: EventGridEvent): void {
    if (!this.leadValidatorService) return;

    const data = (event?.data || event?.payload || {}) as Record<string, any>;

    // 1. Correct Text Extraction
    const userText =
      data.textMessage ||
      data.message ||
      data.description ||
      '';

    // 2. Correct Category Extraction
    const rawCategory =
      data.servicesCategory?.categoryName ||
      data.category;

    const declaredCategory =
      typeof rawCategory === 'string' && rawCategory.trim().length > 0
        ? rawCategory.trim()
        : data.askExpert && data.askExpert !== 'Brick N Mortar'
          ? data.askExpert
          : 'Unspecified';

    // 3. Media Extraction
    const rawMedia = Array.isArray(data.attachments)
      ? data.attachments
      : Array.isArray(data.mediaUrls)
        ? data.mediaUrls
        : [];
    const mediaUrls = rawMedia
      .map((item: any) => (typeof item === 'string' ? item : item?.url || ''))
      .filter(Boolean);

    const ticketId = data.id || data.ticketId || data.quoteId || event?.id || event?.eventId || 'N/A';
    const eventType = event?.eventType || event?.eventName || 'POST_YOUR_REQUIREMENTS';

    const validator = this.leadValidatorService;
    Promise.resolve()
      .then(() =>
        validator.validateLead({
          ticketId,
          eventType,
          userText,
          mediaUrls,
          declaredCategory,
        }),
      )
      .catch((err) => {
        this.logger.error(`Validation error: ${err.message}`);
      });
  }
}
