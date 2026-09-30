import { Global, Module } from '@nestjs/common';
import { AiUsageTelemetryService } from './ai-usage-telemetry.service';

@Global()
@Module({
  providers: [AiUsageTelemetryService],
  exports: [AiUsageTelemetryService],
})
export class TelemetryModule {}
