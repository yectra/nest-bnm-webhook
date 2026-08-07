import { Module } from '@nestjs/common';
import { LocalEventBus } from './local-event-bus';
import { EventGridPublisherService } from './event-grid-publisher.service';

@Module({
  providers: [LocalEventBus, EventGridPublisherService],
  exports: [LocalEventBus, EventGridPublisherService],
})
export class AzureEventsModule {}
