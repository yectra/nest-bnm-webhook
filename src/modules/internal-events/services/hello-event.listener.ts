import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DefaultAzureCredential } from '@azure/identity';
import {
  ServiceBusClient,
  type ServiceBusReceivedMessage,
  type ServiceBusReceiver,
} from '@azure/service-bus';

import type { InternalEvent } from '../interfaces/internal-event.interface';
import { HelloEventService } from './hello-event.service';

/**
 * "Hello world" event listener with no controller.
 *
 * It is a plain provider: nothing maps it to a route, so it adds no HTTP
 * surface at all. Instead of waiting to be called, it pulls events from an
 * Azure Service Bus queue (or topic subscription) over an outbound connection,
 * which is what makes it unreachable from the public internet — there is no
 * inbound port to lock down, and the app can run with
 * publicNetworkAccess=Disabled.
 *
 * Event Grid, or any Azure-internal producer, delivers into the queue; this
 * listener receives from it and hands each event to HelloEventService.
 */
@Injectable()
export class HelloEventListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HelloEventListener.name);

  private client?: ServiceBusClient;
  private receiver?: ServiceBusReceiver;
  private subscription?: { close(): Promise<void> };

  constructor(
    private readonly helloEventService: HelloEventService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('eventListener.enabled')) {
      this.logger.log('Event listener is disabled; not connecting');
      return;
    }

    const source = this.resolveSource();
    if (!source) {
      // Misconfiguration should not take the whole app down: stay idle and
      // make the reason obvious in the logs.
      this.logger.error(
        'Event listener is enabled but no queue or topic/subscription is configured; staying idle',
      );
      return;
    }

    const client = this.createClient();
    if (!client) {
      this.logger.error(
        'Event listener is enabled but neither a connection string nor a namespace is configured; staying idle',
      );
      return;
    }

    this.client = client;
    this.receiver = source.subscriptionName
      ? client.createReceiver(source.name, source.subscriptionName, {
          receiveMode: 'peekLock',
        })
      : client.createReceiver(source.name, { receiveMode: 'peekLock' });

    this.subscription = this.receiver.subscribe(
      {
        processMessage: (message) => this.processMessage(message),
        processError: (args) => {
          this.logger.error(
            `Service Bus error while receiving from ${source.label}: ${args.error.message}`,
          );
          return Promise.resolve();
        },
      },
      {
        autoCompleteMessages: false,
        maxConcurrentCalls:
          this.config.get<number>('eventListener.maxConcurrentCalls') ?? 1,
      },
    );

    this.logger.log(`Listening for events on ${source.label}`);
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.subscription?.close();
      await this.receiver?.close();
      await this.client?.close();
    } catch (error) {
      this.logger.warn(
        `Failed to close the Service Bus listener cleanly: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Handles one message, then settles it explicitly. */
  private async processMessage(
    message: ServiceBusReceivedMessage,
  ): Promise<void> {
    const messageId = String(message.messageId ?? 'n/a');
    const event = this.parseBody(message.body);

    if (!event) {
      this.logger.warn(
        `Dead-lettering message ${messageId}: body is not a JSON event`,
      );
      await this.receiver?.deadLetterMessage(message, {
        deadLetterReason: 'InvalidPayload',
        deadLetterErrorDescription: 'Message body is not a JSON event',
      });
      return;
    }

    try {
      this.helloEventService.handle(event);
      await this.receiver?.completeMessage(message);
    } catch (error) {
      // Abandon so Service Bus redelivers, and dead-letters after the
      // configured maximum number of delivery attempts.
      this.logger.error(
        `Failed to handle message ${messageId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.receiver?.abandonMessage(message);
    }
  }

  /** Event Grid delivers JSON, which arrives as an object, string or bytes. */
  private parseBody(body: unknown): InternalEvent | InternalEvent[] | null {
    let candidate = body;

    if (candidate instanceof Uint8Array) {
      candidate = Buffer.from(candidate).toString('utf8');
    }

    if (typeof candidate === 'string') {
      try {
        candidate = JSON.parse(candidate);
      } catch {
        return null;
      }
    }

    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    return candidate;
  }

  private resolveSource(): {
    name: string;
    subscriptionName?: string;
    label: string;
  } | null {
    const queue = this.config.get<string>('eventListener.queue');
    if (queue) {
      return { name: queue, label: `queue "${queue}"` };
    }

    const topic = this.config.get<string>('eventListener.topic');
    const subscriptionName = this.config.get<string>(
      'eventListener.subscription',
    );

    if (topic && subscriptionName) {
      return {
        name: topic,
        subscriptionName,
        label: `topic "${topic}" subscription "${subscriptionName}"`,
      };
    }

    return null;
  }

  private createClient(): ServiceBusClient | null {
    const connectionString = this.config.get<string>(
      'eventListener.connectionString',
    );
    if (connectionString) {
      return new ServiceBusClient(connectionString);
    }

    // Preferred in Azure: managed identity, so no secret is stored anywhere.
    const namespace = this.config.get<string>('eventListener.namespace');
    if (namespace) {
      return new ServiceBusClient(namespace, new DefaultAzureCredential());
    }

    return null;
  }
}
