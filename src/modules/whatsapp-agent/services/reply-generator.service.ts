import { Injectable, Logger } from '@nestjs/common';
import { templateReply } from '../reply/templates';
import { GeneratedReply, WhatsAppMessage } from '../types';
import { AgentModelService } from './agent-model.service';
import { SupportAgentService } from './support-agent.service';

/**
 * Produces the reply for one inbound message. With an LLM configured the
 * grounded deep agent answers; without one (or if the agent throws) replies
 * degrade to intent templates — the message is always answered.
 */
@Injectable()
export class ReplyGeneratorService {
  private readonly logger = new Logger(ReplyGeneratorService.name);

  constructor(
    private readonly agentModelService: AgentModelService,
    private readonly supportAgentService: SupportAgentService,
  ) {}

  async generate(message: WhatsAppMessage): Promise<GeneratedReply> {
    const model = this.agentModelService.createModel();
    if (model) {
      try {
        return await this.supportAgentService.generateReply(message, model);
      } catch (error) {
        this.logger.warn(
          `support agent failed, falling back to template: ${String(error)}`,
        );
      }
    }
    return { text: templateReply(message), source: 'template' };
  }
}
