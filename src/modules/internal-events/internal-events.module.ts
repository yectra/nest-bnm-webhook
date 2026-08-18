import { Module } from '@nestjs/common';

import { AzureInternalGuard } from '../../common/guards/azure-internal.guard';
import { HelloEventController } from './controllers/hello-event.controller';
import { HelloEventListener } from './services/hello-event.listener';
import { HelloEventService } from './services/hello-event.service';

/**
 * Internal-only event delivery. Two independent ways in, both off by default:
 *
 * - HelloEventListener: a provider with no controller that pulls events from
 *   Azure Service Bus. No route, no inbound port, nothing public to protect.
 * - HelloEventController: an HTTP webhook behind AzureInternalGuard and hidden
 *   from Swagger, for producers that can only push over HTTP.
 *
 * Enable whichever suits the producer (EVENT_LISTENER_ENABLED /
 * INTERNAL_EVENTS_ENABLED); both share HelloEventService.
 */
@Module({
  controllers: [HelloEventController],
  providers: [AzureInternalGuard, HelloEventService, HelloEventListener],
  exports: [HelloEventService],
})
export class InternalEventsModule {}
