import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { WhatsappAgentModule } from './whatsapp-agent.module';
import { CosmosService } from '../database/cosmos.service';
import { AgentModelService } from './services/agent-model.service';
import { CustomerFeedbackService } from './services/customer-feedback.service';
import { HelloAgentService } from './services/hello-agent.service';

describe('WhatsappAgentModule', () => {
  it('compiles and wires the hello-agent stack', async () => {
    // CosmosService is overridden so the test needs no real Cosmos endpoint.
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        WhatsappAgentModule,
      ],
    })
      .overrideProvider(CosmosService)
      .useValue({ getContainer: jest.fn() })
      .compile();

    expect(moduleRef.get(AgentModelService)).toBeInstanceOf(AgentModelService);
    expect(moduleRef.get(CustomerFeedbackService)).toBeInstanceOf(
      CustomerFeedbackService,
    );
    expect(moduleRef.get(HelloAgentService)).toBeInstanceOf(HelloAgentService);
    await moduleRef.close();
  });
});
