import { HelloAgentController } from './hello-agent.controller';
import { HelloAgentService } from '../services/hello-agent.service';

describe('HelloAgentController', () => {
  let run: jest.Mock;
  let controller: HelloAgentController;

  beforeEach(() => {
    run = jest.fn().mockResolvedValue('Hi!');
    controller = new HelloAgentController({
      run,
    } as unknown as HelloAgentService);
  });

  it('GET passes the message through to the agent', async () => {
    await expect(controller.helloGet('Good morning')).resolves.toEqual({
      success: true,
      reply: 'Hi!',
    });
    expect(run).toHaveBeenCalledWith('Good morning');
  });

  it('GET defaults to "Hello!" when no message is given', async () => {
    await controller.helloGet(undefined);
    expect(run).toHaveBeenCalledWith('Hello!');
  });

  it('POST passes the body message through to the agent', async () => {
    await expect(controller.helloPost({ message: 'Yo' })).resolves.toEqual({
      success: true,
      reply: 'Hi!',
    });
    expect(run).toHaveBeenCalledWith('Yo');
  });

  it('POST defaults to "Hello!" when the body has no message', async () => {
    await controller.helloPost({});
    expect(run).toHaveBeenCalledWith('Hello!');
  });
});
