import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EventEnvelope {
  id?: string;
  eventId?: string;
  eventType?: string;
  eventName?: string;
  subject?: string;
  topic?: string;
  eventTime?: string;
  eventTimestamp?: string;
  data?: Record<string, any>;
  payload?: Record<string, any>;
  dataVersion?: string;
  metadataVersion?: string;
}

@Injectable()
export class EventGridEventValidator {
  private readonly logger = new Logger(EventGridEventValidator.name);

  /** Azure Event Grid infrastructure protocol handshake event constant */
  public static readonly PROTOCOL_SUBSCRIPTION_VALIDATION_EVENT =
    'Microsoft.EventGrid.SubscriptionValidationEvent';

  constructor(private readonly configService: ConfigService) {}

  private parseEventTypes(raw?: string): Set<string> {
    if (!raw) return new Set();
    return new Set(
      raw
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    );
  }

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

  public getAllowedEventTypes(): Set<string> {
    const customTypes =
      this.configService.get<string>('azure.eventGridAllowedEventTypes') ||
      this.configService.get<string>('AZURE_EVENT_GRID_ALLOWED_EVENT_TYPES') ||
      process.env.AZURE_EVENT_GRID_ALLOWED_EVENT_TYPES;

    if (customTypes) {
      const set = this.parseEventTypes(customTypes);
      set.add(EventGridEventValidator.PROTOCOL_SUBSCRIPTION_VALIDATION_EVENT);
      return set;
    }

    const combined = new Set<string>([
      ...this.getRequirementsEventTypes(),
      ...this.getQuotesEventTypes(),
      ...this.getWhatsAppEventTypes(),
      EventGridEventValidator.PROTOCOL_SUBSCRIPTION_VALIDATION_EVENT,
    ]);
    return combined;
  }

  /**
   * Validates incoming Event Grid request payload:
   * - Envelope structure (id, eventType, data)
   * - SubscriptionValidationEvent data requirement (validationCode)
   * - Allowed event types
   * - Event Grid topic match (if configured in environment)
   * - Java application event payload structure
   */
  validate(body: any): EventEnvelope[] {
    if (!body || typeof body !== 'object') {
      this.logger.warn('Event validation failed: Request body is empty or not an object');
      throw new BadRequestException('Invalid Event Grid payload: request body must be a JSON object or array');
    }

    const events: EventEnvelope[] = Array.isArray(body) ? body : [body];

    if (events.length === 0) {
      this.logger.warn('Event validation failed: Payload array is empty');
      throw new BadRequestException('Invalid Event Grid payload: event array cannot be empty');
    }

    const configuredTopic =
      this.configService.get<string>('azure.eventGridTopic') ||
      this.configService.get<string>('AZURE_EVENT_GRID_TOPIC') ||
      process.env.AZURE_EVENT_GRID_TOPIC;

    const allowedTypes = this.getAllowedEventTypes();
    const whatsappTypes = this.getWhatsAppEventTypes();
    const requirementsTypes = this.getRequirementsEventTypes();

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      if (!event || typeof event !== 'object') {
        this.logger.warn(`Event validation failed at index ${i}: item is not an object`);
        throw new BadRequestException(`Invalid Event Grid payload at index ${i}: event must be an object`);
      }

      const eventType = (event.eventType || event.eventName || '').trim();
      const eventId = (event.id || event.eventId || '').trim();
      const data = event.data || event.payload;

      // 1. Validate envelope required fields
      if (!eventType) {
        this.logger.warn(`Event validation failed at index ${i}: missing eventType`);
        throw new BadRequestException(`Invalid Event Grid payload at index ${i}: missing required "eventType"`);
      }

      if (!eventId) {
        this.logger.warn(`Event validation failed at index ${i}: missing id`);
        throw new BadRequestException(`Invalid Event Grid payload at index ${i}: missing required "id"`);
      }

      if (!data || typeof data !== 'object') {
        this.logger.warn(`Event validation failed at index ${i}: missing data object`);
        throw new BadRequestException(`Invalid Event Grid payload at index ${i}: missing required "data" object`);
      }

      // 2. Validate subscription validation handshake event
      if (eventType === EventGridEventValidator.PROTOCOL_SUBSCRIPTION_VALIDATION_EVENT) {
        if (!data.validationCode || typeof data.validationCode !== 'string') {
          this.logger.warn(`Subscription validation event missing validationCode`);
          throw new BadRequestException('Invalid SubscriptionValidationEvent: missing validationCode in data');
        }
        continue;
      }

      // 3. Validate allowed event types
      if (!allowedTypes.has(eventType)) {
        this.logger.warn(`Event type "${eventType}" is not in allowed event types list`);
        throw new BadRequestException(`Unexpected Event Grid event type: "${eventType}" is not authorized`);
      }

      // 4. Validate Event Grid Topic (if configured)
      if (configuredTopic && event.topic) {
        if (event.topic.toLowerCase() !== configuredTopic.toLowerCase()) {
          this.logger.warn(`Event topic mismatch: expected "${configuredTopic}", got "${event.topic}"`);
          throw new BadRequestException('Event Grid topic mismatch: event does not originate from authorized topic');
        }
      }

      // 5. Validate specific Java event structure
      if (whatsappTypes.has(eventType)) {
        // Ensure data contains message content or messageId
        if (Object.keys(data).length === 0) {
          this.logger.warn('Java WhatsApp event contains empty data payload');
          throw new BadRequestException(`Invalid ${eventType}: data object cannot be empty`);
        }
      }

      if (requirementsTypes.has(eventType)) {
        if (Object.keys(data).length === 0) {
          this.logger.warn(`${eventType} event contains empty data payload`);
          throw new BadRequestException(`Invalid ${eventType} event: data object cannot be empty`);
        }
      }
    }

    return events;
  }
}
