import { Injectable, Logger } from '@nestjs/common';

import type {
  CloudEvent,
  EventGridSchemaEvent,
  InternalEvent,
  InternalEventAck,
  InternalEventResult,
  SubscriptionValidationData,
  SubscriptionValidationResponse,
} from '../interfaces/internal-event.interface';

const SUBSCRIPTION_VALIDATION_EVENT =
  'Microsoft.EventGrid.SubscriptionValidationEvent';

/**
 * "Hello world" handler for events delivered by Azure internals. It accepts
 * both the Event Grid schema (array of events) and CloudEvents v1.0 (a single
 * event), answers the subscription validation handshake, and logs a greeting
 * for everything else.
 */
@Injectable()
export class HelloEventService {
  private readonly logger = new Logger(HelloEventService.name);

  handle(
    payload: InternalEvent | InternalEvent[],
  ): SubscriptionValidationResponse | InternalEventAck {
    const events = Array.isArray(payload) ? payload : [payload];

    // The handshake arrives on its own, so answer it before anything else.
    for (const event of events) {
      const validationResponse = this.tryValidationHandshake(event);
      if (validationResponse) {
        return validationResponse;
      }
    }

    const results = events.map((event) => this.greet(event));

    return {
      message: 'Hello, world',
      receivedCount: events.length,
      results,
    };
  }

  private tryValidationHandshake(
    event: InternalEvent,
  ): SubscriptionValidationResponse | null {
    if (this.eventType(event) !== SUBSCRIPTION_VALIDATION_EVENT) {
      return null;
    }

    const data = (event as EventGridSchemaEvent<SubscriptionValidationData>)
      .data;
    const validationCode = data?.validationCode;

    if (!validationCode) {
      this.logger.warn(
        'Subscription validation event received without a validation code',
      );
      return null;
    }

    this.logger.log(
      'Answered the Event Grid subscription validation handshake',
    );

    return { validationResponse: validationCode };
  }

  private greet(event: InternalEvent): InternalEventResult {
    const eventId = event?.id;
    const eventType = this.eventType(event);
    const greeting = `Hello, world from ${eventType ?? 'an unlabelled event'}`;

    this.logger.log(
      `${greeting} (id: ${eventId ?? 'n/a'}, subject: ${event?.subject ?? 'n/a'})`,
    );

    return { greeting, eventId, eventType, status: 'handled' };
  }

  /** Event Grid schema uses "eventType"; CloudEvents uses "type". */
  private eventType(event: InternalEvent): string | undefined {
    return (
      (event as EventGridSchemaEvent).eventType ?? (event as CloudEvent).type
    );
  }
}
