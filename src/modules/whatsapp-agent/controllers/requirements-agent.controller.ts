import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { WhatsappAgentEventService } from '../services/whatsapp-agent-event.service';
import { RequirementsEventDto } from '../dto/requirements-event.dto';

/**
 * Replay endpoint for the "Post Your Requirements" branch:
 * `POST /api/whatsapp-agent/requirements-event` takes an Event Grid envelope,
 * qualifies it, and — unlike the Event Grid webhook, which acknowledges first
 * and answers in the background — waits for the agent so the answer, the
 * LangSmith run id, and the customer names come back in the response.
 */
@ApiTags('WhatsApp Agent')
@Controller('whatsapp-agent')
export class RequirementsAgentController {
  constructor(
    private readonly whatsappAgentEventService: WhatsappAgentEventService,
  ) {}

  @Post('requirements-event')
  async handleRequirementsEvent(@Body() body: RequirementsEventDto) {
    const outcome = await this.whatsappAgentEventService.handleEvent(body);
    return { success: true, ...outcome };
  }
}
