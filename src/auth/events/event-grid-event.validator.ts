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

  // Default recognized event types in the project
  private static readonly DEFAULT_ALLOWED_EVENT_TYPES = [
    'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
    'POST_YOUR_REQUIREMENTS',
    'Microsoft.EventGrid.SubscriptionValidationEvent',
  ];

  constructor(private readonly configService: ConfigService) {}

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

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      if (!event || typeof event !== 'object') {
        this.logger.warn(`Event validation failed at index ${i}: item is not an object`);
        throw new BadRequestException(`Invalid Event Grid payload at index ${i}: event must be an object`);
      }

      const eventType = event.eventType || event.eventName;
      const eventId = event.id || event.eventId;
      const data = event.data || event.payload;

      // 1. Validate envelope required fields
      if (!eventType || typeof eventType !== 'string' || eventType.trim() === '') {
        this.logger.warn(`Event validation failed at index ${i}: missing eventType`);
        throw new BadRequestException(`Invalid Event Grid payload at index ${i}: missing required "eventType"`);
      }

      if (!eventId || typeof eventId !== 'string' || eventId.trim() === '') {
        this.logger.warn(`Event validation failed at index ${i}: missing id`);
        throw new BadRequestException(`Invalid Event Grid payload at index ${i}: missing required "id"`);
      }

      if (!data || typeof data !== 'object') {
        this.logger.warn(`Event validation failed at index ${i}: missing data object`);
        throw new BadRequestException(`Invalid Event Grid payload at index ${i}: missing required "data" object`);
      }

      // 2. Validate subscription validation handshake event
      if (eventType === 'Microsoft.EventGrid.SubscriptionValidationEvent') {
        if (!data.validationCode || typeof data.validationCode !== 'string') {
          this.logger.warn(`Subscription validation event missing validationCode`);
          throw new BadRequestException('Invalid SubscriptionValidationEvent: missing validationCode in data');
        }
        continue;
      }

      // 3. Validate allowed event types
      if (!allowedTypes.includes(eventType)) {
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
      if (eventType === 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT') {
        // Ensure data contains message content or messageId
        if (Object.keys(data).length === 0) {
          this.logger.warn('Java WhatsApp event contains empty data payload');
          throw new BadRequestException('Invalid BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT: data object cannot be empty');
        }
      }

      if (eventType === 'POST_YOUR_REQUIREMENTS') {
        if (Object.keys(data).length === 0) {
          this.logger.warn('POST_YOUR_REQUIREMENTS event contains empty data payload');
          throw new BadRequestException('Invalid POST_YOUR_REQUIREMENTS event: data object cannot be empty');
        }
      }
    }

    return events;
  }

  private getAllowedEventTypes(): string[] {
    const customTypes =
      this.configService.get<string>('azure.eventGridAllowedEventTypes') ||
      this.configService.get<string>('AZURE_EVENT_GRID_ALLOWED_EVENT_TYPES') ||
      process.env.AZURE_EVENT_GRID_ALLOWED_EVENT_TYPES;

    if (customTypes) {
      return customTypes
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
    }

    return EventGridEventValidator.DEFAULT_ALLOWED_EVENT_TYPES;
  }
}
