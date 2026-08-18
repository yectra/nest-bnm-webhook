// The Cosmos client is constructed eagerly by CosmosService, so the module
// under test needs credentials present. Nothing here reaches the network.
process.env.COSMOS_ENDPOINT ||= 'https://example.documents.azure.com:443/';
process.env.COSMOS_KEY ||= 'test-key';
process.env.COSMOS_DATABASE ||= 'test-db';

import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';

import appConfig from '../../config/app.config';
import whatsappAgentConfig from '../../config/whatsapp-agent.config';
import { WhatsappModule } from './whatsapp.module';
import { EventGridService } from './services/event-grid.service';
import { WhatsappAgentEventService } from '../whatsapp-agent/services/whatsapp-agent-event.service';

describe('WhatsappModule wiring', () => {
  it('injects the WhatsApp agent branch into the Event Grid service', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [appConfig, whatsappAgentConfig],
        }),
        WhatsappModule,
      ],
    }).compile();

    const eventGrid = moduleRef.get(EventGridService);
    const agentEvents = moduleRef.get(WhatsappAgentEventService, {
      strict: false,
    });

    const spy = jest
      .spyOn(agentEvents, 'handleQualifiedInBackground')
      .mockImplementation(() => undefined);

    const result: unknown = eventGrid.processEvent({
      id: 'smoke-1',
      eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
      data: {
        formType: 'POST_YOUR_REQUIREMENTS',
        message: 'give me all customer names',
      },
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ qualified: true }),
    );
    expect(result).toMatchObject({
      results: [{ routedTo: 'post-your-requirements-agent' }],
    });

    await moduleRef.close();
  }, 30000);
});
