import { Body, Controller, Logger, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentCrewService } from './agent-crew.service';
import { CrewMessageDto } from './dto/crew-message.dto';
import { CrewResponseDto } from './dto/crew-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@ApiTags('agent-crew')
@ApiBearerAuth()
@Controller('agent-crew')
export class AgentCrewController {
  private readonly logger = new Logger(AgentCrewController.name);

  constructor(private readonly agentCrewService: AgentCrewService) {}

  @Post('chat')
  @ApiOperation({
    summary: 'Run the LangGraph agent crew for a user question',
    description:
      'A GPT-5 supervisor fans out to parallel retrieval agents (service catalog vectors, ' +
      "the user's quotes, and pictures attached to quotes or Post Your Requirements forms), " +
      'synthesizes an answer, filters PII, then delivers it to the Teams channel and WebSocket clients.',
  })
  async chat(
    @Body() dto: CrewMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CrewResponseDto> {
    this.logger.log(
      `Received POST /api/agent-crew/chat from userId=${user.userId}: ${JSON.stringify(dto)}`,
    );
    // The signed-in user identifies the run when the client does not send an
    // application-level user ID of its own.
    return this.agentCrewService.run({
      ...dto,
      userId: dto.userId || user.userId,
    });
  }
}
