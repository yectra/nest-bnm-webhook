import { Body, Controller, Logger, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentCrewService } from './agent-crew.service';
import { CrewMessageDto } from './dto/crew-message.dto';
import { CrewResponseDto } from './dto/crew-response.dto';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('agent-crew')
@Controller('agent-crew')
export class AgentCrewController {
  private readonly logger = new Logger(AgentCrewController.name);

  constructor(private readonly agentCrewService: AgentCrewService) {}

  @Public()
  @Post('chat')
  @ApiOperation({
    summary: 'Run the LangGraph agent crew for a user question',
    description:
      'A GPT-5 supervisor fans out to parallel retrieval agents (service catalog vectors, ' +
      "the user's quotes, and pictures attached to quotes or Post Your Requirements forms), " +
      'synthesizes an answer, filters PII, then delivers it to the Teams channel and WebSocket clients.',
  })
  async chat(@Body() dto: CrewMessageDto): Promise<CrewResponseDto> {
    this.logger.log(
      `Received POST /api/agent-crew/chat: ${JSON.stringify(dto)}`,
    );
    return this.agentCrewService.run(dto);
  }
}
