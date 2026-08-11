import { Injectable, Logger } from '@nestjs/common';
import { REFUSAL_TEXT } from '../guard/adversary-guard';
import { templateReply } from '../reply/templates';
import { GeneratedReply, WhatsAppMessage } from '../types';
import { AgentModelService } from './agent-model.service';
import { GuardService } from './guard.service';
import { SupportAgentService } from './support-agent.service';

/**
 * Produces the reply for one inbound message. With an LLM configured the
 * grounded deep agent answers (the adversary guard runs inside it as
 * beforeAgent middleware); without one, guard layers a–b still screen the
 * text before intent templates answer. Any agent failure degrades to
 * templates — the message is always answered.
 */
@Injectable()
export class ReplyGeneratorService {
  private readonly logger = new Logger(ReplyGeneratorService.name);

  constructor(
    private readonly agentModelService: AgentModelService,
    private readonly supportAgentService: SupportAgentService,
    private readonly guardService: GuardService,
  ) {}

  async generate(message: WhatsAppMessage): Promise<GeneratedReply> {
    const model = this.agentModelService.createModel();
    if (model) {
      try {
        return await this.supportAgentService.generateReply(
          message,
          model,
          this.guardService.middleware(),
        );
      } catch (error) {
        this.logger.warn(
          `support agent failed, falling back to template: ${String(error)}`,
        );
      }
    }

    // No-LLM mode (or agent fallback): guard layers a-b still run; the LLM
    // classifier (layer c) needs the model and is skipped automatically.
    const verdict = await this.guardService.assess(message.body ?? '');
    if (verdict.adversarial) {
      this.logger.warn(
        `blocked adversarial input in template mode (layer=${verdict.layer}, category=${verdict.category})`,
      );
      await this.guardService.learn(message.body ?? '', verdict.category);
      return { text: REFUSAL_TEXT, source: 'refusal' };
    }
    return { text: templateReply(message), source: 'template' };
  }
}
