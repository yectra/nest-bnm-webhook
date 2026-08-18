import { Module } from '@nestjs/common';

import { HelloEventListener } from './services/hello-event.listener';
import { HelloEventService } from './services/hello-event.service';

/**
 * Internal event listener. The module registers no controller, so it adds no
 * route and no inbound port: HelloEventListener pulls events from Azure
 * Service Bus over an outbound connection instead.
 */
@Module({
  providers: [HelloEventService, HelloEventListener],
  exports: [HelloEventService],
})
export class InternalEventsModule {}
