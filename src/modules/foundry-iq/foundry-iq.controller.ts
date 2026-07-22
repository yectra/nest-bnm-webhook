import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AskAgentDto } from './dto/ask-agent.dto';
import { FoundryAgentAnswer } from './interfaces/foundry-agent-answer.interface';
import { FoundryIqAgentService } from './foundry-iq-agent.service';

@ApiTags('foundry')
@Controller('foundry')
export class FoundryIqController {
  constructor(private readonly foundryIqAgentService: FoundryIqAgentService) {}

  @Post('ask')
  @ApiOperation({
    summary: 'Ask the grounded Foundry IQ agent',
    description:
      'Asks the Foundry IQ agent a question answered across the unified knowledge base — SharePoint documents (Work IQ) and the Fabric IQ business-data ontology. Returns the answer plus resolved SharePoint document citations.',
  })
  async ask(@Body() dto: AskAgentDto): Promise<FoundryAgentAnswer> {
    return this.foundryIqAgentService.ask(dto.question, dto.threadId);
  }
}
