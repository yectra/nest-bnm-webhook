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

  /** Azure Event Grid infrastructure protocol handshake event constant */
  public static readonly PROTOCOL_SUBSCRIPTION_VALIDATION_EVENT =
    'Microsoft.EventGrid.SubscriptionValidationEvent';

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

  public getRequirementsEventTypes(): Set<string> {
    const raw =
      this.configService.get<string>('azure.eventGridEventTypesRequirements') ||
      this.configService.get<string>('EVENT_GRID_EVENT_TYPES_REQUIREMENTS') ||
      process.env.EVENT_GRID_EVENT_TYPES_REQUIREMENTS ||
      'POST_YOUR_REQUIREMENT,POST_YOUR_REQUIREMENTS';
    return this.parseEventTypes(raw);
  }

  public getQuotesEventTypes(): Set<string> {
    const raw =
      this.configService.get<string>('azure.eventGridEventTypesQuotes') ||
      this.configService.get<string>('EVENT_GRID_EVENT_TYPES_QUOTES') ||
      process.env.EVENT_GRID_EVENT_TYPES_QUOTES ||
      'QUOTE_CREATED_EVENT';
    return this.parseEventTypes(raw);
  }

  public getWhatsAppEventTypes(): Set<string> {
    const raw =
      this.configService.get<string>('azure.eventGridEventTypesWhatsApp') ||
      this.configService.get<string>('EVENT_GRID_EVENT_TYPES_WHATSAPP') ||
      process.env.EVENT_GRID_EVENT_TYPES_WHATSAPP ||
      'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT';
    return this.parseEventTypes(raw);
  }

  private parseEventTypes(raw: string): Set<string> {
    return new Set(
      raw
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    );
  }

  async processEvent(payload: EventGridEvent | EventGridEvent[]) {
    const events = Array.isArray(payload) ? payload : [payload];
    const results: any[] = [];

    const reqTypes = this.getRequirementsEventTypes();
    const quoteTypes = this.getQuotesEventTypes();
    const whatsappTypes = this.getWhatsAppEventTypes();

    for (const event of events) {
      const eventType = (event?.eventType || event?.eventName || 'UNKNOWN_EVENT').trim();
      const eventId = event?.id || event?.eventId || 'N/A';

      if (eventType === EventGridService.PROTOCOL_SUBSCRIPTION_VALIDATION_EVENT) {
        this.logger.log(`[EVENT] type=${eventType} handler=SubscriptionValidation`);
        return this.handleSubscriptionValidation(event);
      }

      if (reqTypes.has(eventType)) {
        this.logger.log(`[EVENT] type=${eventType} handler=PostYourRequirementsAgent`);
        this.triggerLeadValidator(event, eventType);

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
      } else if (quoteTypes.has(eventType)) {
        this.logger.log(`[EVENT] type=${eventType} handler=RequestAQuoteAgent`);
        this.triggerLeadValidator(event, eventType);

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
      } else if (whatsappTypes.has(eventType)) {
        this.logger.log(`[EVENT] type=${eventType} handler=WhatsAppIncoming`);
        this.triggerLeadValidator(event, eventType);

        this.logger.log(`Processing WhatsApp event: ${eventId}`);
        results.push({
          status: 'success',
          eventId,
          eventType,
        });
      } else {
        this.logger.warn(`No dedicated handler registered for eventType: ${eventType}`);
        results.push({
          status: 'ignored',
          eventId,
          eventType,
        });
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

  private triggerLeadValidator(event: EventGridEvent, resolvedEventType?: string): void {
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
    const eventType = resolvedEventType || event?.eventType || event?.eventName || 'UNKNOWN_EVENT';

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
