import { Module } from '@nestjs/common';

import { SharePointModule } from '../sharepoint/sharepoint.module';
import { FoundryIqController } from './foundry-iq.controller';
import { FoundryIqAgentService } from './foundry-iq-agent.service';

/**
 * Foundry IQ agent module (Epic B / B3).
 *
 * Wires the agent service and the user-facing `POST /foundry/ask` route. Imports
 * {@link SharePointModule} (B2) to resolve document citations. The agent grounds
 * on the unified knowledge base (SharePoint docs + the Fabric IQ ontology from
 * A5) in the Foundry portal, so no direct import of the Fabric service is needed
 * here.
 */
@Module({
  imports: [SharePointModule],
  controllers: [FoundryIqController],
  providers: [FoundryIqAgentService],
  exports: [FoundryIqAgentService],
})
export class FoundryIqModule {}
