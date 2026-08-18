import { Injectable, Logger } from '@nestjs/common';

import type {
  CloudEvent,
  EventGridSchemaEvent,
  InternalEvent,
  InternalEventAck,
  InternalEventResult,
} from '../interfaces/internal-event.interface';

/**
 * "Hello world" handler for events delivered by Azure internals. It accepts
 * both the Event Grid schema (an array of events) and CloudEvents v1.0 (a
 * single event), and logs a greeting for each one.
 */
@Injectable()
export class HelloEventService {
  private readonly logger = new Logger(HelloEventService.name);

  handle(payload: InternalEvent | InternalEvent[]): InternalEventAck {
    const events = Array.isArray(payload) ? payload : [payload];
    const results = events.map((event) => this.greet(event));

    return {
      message: 'Hello, world',
      receivedCount: events.length,
      results,
    };
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
