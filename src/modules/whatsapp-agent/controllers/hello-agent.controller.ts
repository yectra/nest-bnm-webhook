import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { HelloAgentService } from '../services/hello-agent.service';
import { HelloAgentDto } from '../dto/hello-agent.dto';

/**
 * Hello-world endpoint proving the deep-agent stack end to end:
 * GET /api/hello-agent?message=Hi or POST /api/hello-agent {"message":"Hi"}.
 */
@Controller('hello-agent')
export class HelloAgentController {
  constructor(private readonly helloAgentService: HelloAgentService) {}

  @Get()
  async helloGet(@Query('message') message?: string) {
    const reply = await this.helloAgentService.run(message || 'Hello!');
    return { success: true, reply };
  }

  @Post()
  async helloPost(@Body() body: HelloAgentDto) {
    const reply = await this.helloAgentService.run(body.message || 'Vanakkam!');
    return { success: true, reply };
  }
}
