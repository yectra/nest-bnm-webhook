/** Azure Event Grid schema event (the array-wrapped format). */
export interface EventGridSchemaEvent<T = unknown> {
  id?: string;
  topic?: string;
  subject?: string;
  eventType?: string;
  eventTime?: string;
  dataVersion?: string;
  metadataVersion?: string;
  data?: T;
}

/** CloudEvents v1.0 schema event, as delivered by Event Grid. */
export interface CloudEvent<T = unknown> {
  id?: string;
  source?: string;
  type?: string;
  time?: string;
  subject?: string;
  specversion?: string;
  datacontenttype?: string;
  data?: T;
}

export type InternalEvent = EventGridSchemaEvent | CloudEvent;

export interface InternalEventResult {
  /** "Hello, world" greeting produced for the event. */
  greeting: string;
  eventId?: string;
  eventType?: string;
  status: 'handled';
}

export interface InternalEventAck {
  message: string;
  receivedCount: number;
  results: InternalEventResult[];
}
