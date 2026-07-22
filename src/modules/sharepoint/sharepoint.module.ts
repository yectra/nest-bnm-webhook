import { Module } from '@nestjs/common';

import { GraphModule } from '../graph/graph.module';
import { SharePointController } from './sharepoint.controller';
import { SharePointDocService } from './sharepoint-doc.service';

/**
 * SharePoint document module (Epic B / B2). Searches/retrieves documents via
 * Microsoft Graph (using the shared {@link GraphModule}) and exposes a
 * user-facing search route. Exports the service for the Foundry IQ agent (B3).
 */
@Module({
  imports: [GraphModule],
  controllers: [SharePointController],
  providers: [SharePointDocService],
  exports: [SharePointDocService],
})
export class SharePointModule {}
