import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HelloAgentDto } from './hello-agent.dto';

describe('HelloAgentDto', () => {
  it('accepts a string message', async () => {
    const dto = plainToInstance(HelloAgentDto, { message: 'Hello agent' });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('accepts a missing message (optional)', async () => {
    const dto = plainToInstance(HelloAgentDto, {});
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects a non-string message', async () => {
    const dto = plainToInstance(HelloAgentDto, { message: 123 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isString');
  });
});
