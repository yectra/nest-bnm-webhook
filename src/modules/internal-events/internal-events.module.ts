import { Module } from '@nestjs/common';

import { AzureInternalGuard } from '../../common/guards/azure-internal.guard';
import { HelloEventController } from './controllers/hello-event.controller';
import { HelloEventService } from './services/hello-event.service';

/**
 * Internal-only event listener. Not part of the public API surface: its routes
 * are guarded by AzureInternalGuard and hidden from Swagger.
 */
@Module({
  controllers: [HelloEventController],
  providers: [AzureInternalGuard, HelloEventService],
  exports: [HelloEventService],
})
export class InternalEventsModule {}
