import { Inject, Injectable, Logger } from '@nestjs/common';
import { CrewLlmProvider } from './crew-llm.provider';
import { CrewPlan } from '../interfaces/crew.interfaces';
import {
  CREW_AGENTS,
  CrewAgentDefinition,
} from '../graph/crew-agent.definition';
import { buildSupervisorSystemPrompt } from '../prompts/crew.prompts';

/**
 * GPT-5 planner. The plan schema, planning prompt, and keyword fallback are
 * all derived from the CREW_AGENTS registry, so a newly registered agent is
 * automatically plannable. Disabled agents are never offered to the planner
 * and never appear in the plan.
 */
@Injectable()
export class SupervisorAgentService {
  private readonly logger = new Logger(SupervisorAgentService.name);

  constructor(
    private readonly llm: CrewLlmProvider,
    @Inject(CREW_AGENTS)
    private readonly agents: CrewAgentDefinition[],
  ) {}

  async plan(question: string): Promise<CrewPlan> {
    const enabledAgents = this.agents.filter((agent) => agent.enabled());
    const fallback = this.heuristicPlan(question, enabledAgents);

    const parsed = await this.llm.completeJson<Record<string, unknown>>(
      buildSupervisorSystemPrompt(enabledAgents),
      `User question: ${question}`,
    );

    if (!parsed) {
      this.logger.warn(
        'Supervisor LLM plan unavailable, using keyword heuristic plan',
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
    enabledAgents: CrewAgentDefinition[],
  ): CrewPlan {
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
    enabledAgents: CrewAgentDefinition[],
  ): void {
    if (enabledAgents.length > 0 && !Object.values(flags).some(Boolean)) {
      flags[enabledAgents[0].planKey] = true;
    }
  }
}
