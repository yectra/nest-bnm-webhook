import { Module } from '@nestjs/common';
import { GraphClientService } from './graph-client.service';

/**
 * Shared Microsoft Graph module (Epic B / B1). Provides the authenticated Graph
 * client for downstream document services (SharePoint retrieval in B2, Foundry
 * IQ agent grounding in B3).
 */
@Module({
  providers: [GraphClientService],
  exports: [GraphClientService],
})
export class GraphModule {}
