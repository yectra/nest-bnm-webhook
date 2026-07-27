import { Module } from '@nestjs/common';

import { FabricIqService } from './fabric-iq.service';

/**
 * Fabric IQ module (Epic A / A5). Provides the service that queries the Fabric
 * ontology/graph (GraphQL + GQL) over the mirrored business data (A4). Exported
 * for the Foundry IQ agent (Epic B / B3), which grounds on both this ontology
 * and the SharePoint documents.
 */
@Module({
  providers: [FabricIqService],
  exports: [FabricIqService],
})
export class FabricIqModule {}
