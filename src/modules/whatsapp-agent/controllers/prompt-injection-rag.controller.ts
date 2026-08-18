import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';

import { RequiredApiKeyGuard } from '../../../common/guards/required-api-key.guard';
import { PromptInjectionRagService } from '../services/prompt-injection-rag.service';

/**
 * Administrative trigger for the same rebuild the Event Grid branch runs, for
 * bootstrapping a new environment and for replaying a failed event. It deletes
 * and rewrites the RAG, so it is key-protected like the other administrative
 * routes in this codebase.
 */
@ApiTags('WhatsApp Agent')
@ApiHeader({ name: 'x-api-key', required: true })
@Controller('whatsapp-agent/prompt-injection-rag')
@UseGuards(RequiredApiKeyGuard)
export class PromptInjectionRagController {
  constructor(
    private readonly promptInjectionRagService: PromptInjectionRagService,
  ) {}

  @Post('rebuild')
  async rebuild() {
    const result = await this.promptInjectionRagService.rebuild();
    return { success: result.status === 'success', result };
  }
}
