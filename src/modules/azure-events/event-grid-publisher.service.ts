import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { LocalEventBus } from './local-event-bus';
import {
  AzureEventGridEvent,
  EventPublishResult,
} from './interfaces/azure-event.interfaces';

/**
 * Publishes events to an Azure Event Grid custom topic (EventGridEvent
 * schema, aeg-sas-key auth). Event Grid then pushes each event back into the
 * app through the /webhook/whatsapp/events subscription endpoint, which is
 * what makes the processing hop asynchronous and durable.
 *
 * When the topic is not configured, or the POST to it fails, the event falls
 * back to the in-process LocalEventBus so messages are still processed
 * asynchronously in local/dev environments.
 */
@Injectable()
export class EventGridPublisherService {
  private readonly logger = new Logger(EventGridPublisherService.name);
  private readonly topicEndpoint?: string;
  private readonly topicKey?: string;

  constructor(
    config: ConfigService,
    private readonly localEventBus: LocalEventBus,
  ) {
    this.topicEndpoint = config.get<string>('AZURE_EVENT_GRID_TOPIC_ENDPOINT');
    this.topicKey = config.get<string>('AZURE_EVENT_GRID_TOPIC_KEY');
  }

  isEventGridConfigured(): boolean {
    return Boolean(this.topicEndpoint && this.topicKey);
  }

  async publish<T>(
    eventType: string,
    subject: string,
    data: T,
  ): Promise<EventPublishResult> {
    const event: AzureEventGridEvent<T> = {
      id: randomUUID(),
      eventType,
      subject,
      eventTime: new Date().toISOString(),
      data,
      dataVersion: '1.0',
    };

    if (this.isEventGridConfigured()) {
      try {
        await axios.post(this.topicEndpoint!, [event], {
          headers: {
            'aeg-sas-key': this.topicKey!,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        });
        this.logger.log(
          `Published ${eventType} to Event Grid (eventId=${event.id}, subject=${subject})`,
        );
        return { published: true, transport: 'eventgrid', eventId: event.id };
      } catch (error) {
        this.logger.error(
          `Event Grid publish failed for ${eventType} (eventId=${event.id}); falling back to local bus`,
          error,
        );
        this.localEventBus.emit(event);
        return {
          published: true,
          transport: 'local',
          eventId: event.id,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    this.logger.log(
      `Event Grid topic not configured; delivering ${eventType} on local bus (eventId=${event.id})`,
    );
    this.localEventBus.emit(event);
    return { published: true, transport: 'local', eventId: event.id };
  }
}
