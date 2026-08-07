import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { AzureEventGridEvent } from './interfaces/azure-event.interfaces';

type EventHandler<T> = (event: AzureEventGridEvent<T>) => void | Promise<void>;

/**
 * In-process fallback delivery channel. When the Azure Event Grid topic is not
 * configured (local development) — or a publish to it fails — events are
 * emitted here so async processing still happens, just without the durable
 * hop through Azure. Handlers run on the next tick, never inline with the
 * publisher, so webhook responses are never blocked by processing.
 */
@Injectable()
export class LocalEventBus {
  private readonly logger = new Logger(LocalEventBus.name);
  private readonly emitter = new EventEmitter();

  emit<T>(event: AzureEventGridEvent<T>): void {
    setImmediate(() => this.emitter.emit(event.eventType, event));
  }

  subscribe<T>(eventType: string, handler: EventHandler<T>): void {
    this.emitter.on(eventType, (event: AzureEventGridEvent<T>) => {
      Promise.resolve(handler(event)).catch((error) =>
        this.logger.error(
          `Local handler for ${eventType} failed (eventId=${event.id})`,
          error,
        ),
      );
    });
  }
}
