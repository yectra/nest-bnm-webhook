import { Inject, Injectable, Logger } from '@nestjs/common';
import { CrewLlmProvider } from '../../agent-crew/services/crew-llm.provider';
import { WhatsappCrewPlan } from '../interfaces/whatsapp-crew.interfaces';
import {
  WHATSAPP_CREW_AGENTS,
  WhatsappCrewAgentDefinition,
} from '../graph/whatsapp-crew-agent.definition';
import { buildWhatsappSupervisorPrompt } from '../prompts/whatsapp-crew.prompts';

/**
 * LLM planner for the WhatsApp crew. The plan schema, planning prompt, and
 * keyword fallback are all derived from the WHATSAPP_CREW_AGENTS registry,
 * so a newly registered agent is automatically plannable.
 */
@Injectable()
export class WhatsappSupervisorService {
  private readonly logger = new Logger(WhatsappSupervisorService.name);

  constructor(
    private readonly llm: CrewLlmProvider,
    @Inject(WHATSAPP_CREW_AGENTS)
    private readonly agents: WhatsappCrewAgentDefinition[],
  ) {}

  async plan(question: string): Promise<WhatsappCrewPlan> {
    const enabledAgents = this.agents.filter((agent) => agent.enabled());
    const fallback = this.heuristicPlan(question, enabledAgents);

    const parsed = await this.llm.completeJson<Record<string, unknown>>(
      buildWhatsappSupervisorPrompt(enabledAgents),
      `Customer WhatsApp message: ${question}`,
    );

    if (!parsed) {
      this.logger.warn(
        'WhatsApp supervisor LLM plan unavailable, using keyword heuristic plan',
      );
      return fallback;
    }

    const flags: Record<string, boolean> = {};
    for (const agent of enabledAgents) {
      const value = parsed[agent.planKey];
      flags[agent.planKey] =
        typeof value === 'boolean'
          ? value
          : (fallback.agents[agent.planKey] ?? false);
    }
    this.ensureAtLeastOneAgent(flags, enabledAgents);

    return {
      agents: flags,
      rationale:
        typeof parsed.rationale === 'string' && parsed.rationale.length > 0
          ? parsed.rationale
          : fallback.rationale,
    };
  }

  private heuristicPlan(
    question: string,
    enabledAgents: WhatsappCrewAgentDefinition[],
  ): WhatsappCrewPlan {
    const flags: Record<string, boolean> = {};
    for (const agent of enabledAgents) {
      flags[agent.planKey] = agent.planHeuristic(question);
    }
    this.ensureAtLeastOneAgent(flags, enabledAgents);
    return {
      agents: flags,
      rationale: 'Keyword heuristic plan (LLM planner unavailable)',
    };
  }

  /** Never plan an empty crew: fall back to the first enabled agent. */
  private ensureAtLeastOneAgent(
    flags: Record<string, boolean>,
    enabledAgents: WhatsappCrewAgentDefinition[],
  ): void {
    if (enabledAgents.length > 0 && !Object.values(flags).some(Boolean)) {
      flags[enabledAgents[0].planKey] = true;
    }
  }
}
