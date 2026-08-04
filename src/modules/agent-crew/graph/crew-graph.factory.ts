import { Inject, Injectable, Logger } from '@nestjs/common';
import { END, START, StateGraph } from '@langchain/langgraph';
import { CrewState, CrewStateAnnotation, traceEntry } from './crew-state';
import { CREW_AGENTS, CrewAgentDefinition } from './crew-agent.definition';
import { SupervisorAgentService } from '../services/supervisor-agent.service';
import { SynthesizerAgentService } from '../services/synthesizer-agent.service';
import { PiiFilterService } from '../services/pii-filter.service';
import { CrewDispatchService } from '../services/crew-dispatch.service';

/**
 * Fixed backbone nodes. The retrieval slots between supervisor and
 * synthesize come from the CREW_AGENTS registry; the tail is deliberately
 * hardcoded so no answer can skip PII filtering before dispatch.
 * Note: node names must not collide with state channel names ("dispatch").
 */
export const CREW_BACKBONE = {
  SUPERVISOR: 'supervisor',
  SYNTHESIZE: 'synthesize',
  PII_FILTER: 'piiFilter',
  DISPATCH: 'dispatchAgent',
} as const;

/** Minimal invocable surface of the compiled graph used by the crew service. */
export interface CompiledCrewGraph {
  invoke(input: Partial<CrewState>): Promise<CrewState>;
  getGraph(): { drawMermaid(): string };
}

/**
 * Registry-driven wiring: node names are runtime strings, so the builder is
 * used through this untyped surface instead of LangGraph's literal-type
 * chaining. assertNodeNames() provides the safety the types would have.
 */
interface DynamicGraphBuilder {
  addNode(
    name: string,
    fn: (state: CrewState) => Promise<Partial<CrewState>>,
  ): DynamicGraphBuilder;
  addEdge(from: string, to: string): DynamicGraphBuilder;
  addConditionalEdges(
    from: string,
    router: (state: CrewState) => string[],
    targets: string[],
  ): DynamicGraphBuilder;
  compile(): CompiledCrewGraph;
}

/**
 * Builds the compiled LangGraph crew:
 *
 *   START -> supervisor -+-> [registered agent 0] -+
 *                        +-> [registered agent 1] -+-> synthesize -> piiFilter -> dispatchAgent -> END
 *                        +-> [registered agent n] -+
 *
 * Retrieval agents come from the CREW_AGENTS registry: each is a node, an
 * edge into synthesize, a conditional-routing target, and a line in the
 * supervisor's planning prompt. Adding an agent never touches this factory.
 * The agents selected by the supervisor run in parallel within one superstep
 * and fan back in at the synthesize node.
 */
@Injectable()
export class CrewGraphFactory {
  private readonly logger = new Logger(CrewGraphFactory.name);

  constructor(
    @Inject(CREW_AGENTS)
    private readonly agents: CrewAgentDefinition[],
    private readonly supervisorAgent: SupervisorAgentService,
    private readonly synthesizerAgent: SynthesizerAgentService,
    private readonly piiFilterService: PiiFilterService,
    private readonly crewDispatchService: CrewDispatchService,
  ) {}

  build(): CompiledCrewGraph {
    this.assertNodeNames();

    const graph = new StateGraph(
      CrewStateAnnotation,
    ) as unknown as DynamicGraphBuilder;

    graph
      .addNode(CREW_BACKBONE.SUPERVISOR, (state) => this.runSupervisor(state))
      .addNode(CREW_BACKBONE.SYNTHESIZE, (state) => this.runSynthesizer(state))
      .addNode(CREW_BACKBONE.PII_FILTER, (state) => this.runPiiFilter(state))
      .addNode(CREW_BACKBONE.DISPATCH, (state) => this.runDispatch(state))
      .addEdge(START, CREW_BACKBONE.SUPERVISOR);

    for (const agent of this.agents) {
      graph
        .addNode(agent.name, (state) => agent.run(state))
        .addEdge(agent.name, CREW_BACKBONE.SYNTHESIZE);
    }

    graph
      .addConditionalEdges(
        CREW_BACKBONE.SUPERVISOR,
        (state) => this.routeFromSupervisor(state),
        this.agents.map((agent) => agent.name),
      )
      .addEdge(CREW_BACKBONE.SYNTHESIZE, CREW_BACKBONE.PII_FILTER)
      .addEdge(CREW_BACKBONE.PII_FILTER, CREW_BACKBONE.DISPATCH)
      .addEdge(CREW_BACKBONE.DISPATCH, END);

    this.logger.log(
      `Crew graph built with ${this.agents.length} registered agents: ${this.agents
        .map((agent) => `${agent.name}${agent.enabled() ? '' : ' (disabled)'}`)
        .join(', ')}`,
    );
    return graph.compile();
  }

  /**
   * LangGraph rejects node names that collide with state channels only at
   * build time with a cryptic error; fail fast with a clear one instead,
   * and also catch duplicate or backbone-shadowing registry entries.
   */
  private assertNodeNames(): void {
    const channels = new Set(Object.keys(CrewStateAnnotation.spec ?? {}));
    const reserved = new Set<string>(Object.values(CREW_BACKBONE));
    const seen = new Set<string>();

    for (const agent of this.agents) {
      if (channels.has(agent.name)) {
        throw new Error(
          `Crew agent node "${agent.name}" collides with a state channel name`,
        );
      }
      if (reserved.has(agent.name)) {
        throw new Error(
          `Crew agent node "${agent.name}" collides with a backbone node name`,
        );
      }
      if (seen.has(agent.name)) {
        throw new Error(`Duplicate crew agent node name "${agent.name}"`);
      }
      seen.add(agent.name);
    }
  }

  private routeFromSupervisor(state: CrewState): string[] {
    const active = this.agents
      .filter((agent) => agent.enabled() && state.plan?.agents?.[agent.planKey])
      .map((agent) => agent.name);

    if (active.length > 0) {
      return active;
    }
    const fallback =
      this.agents.find((agent) => agent.enabled()) ?? this.agents[0];
    return [fallback.name];
  }

  private async runSupervisor(state: CrewState): Promise<Partial<CrewState>> {
    const plan = await this.supervisorAgent.plan(state.question);
    return {
      plan,
      trace: [
        traceEntry(
          CREW_BACKBONE.SUPERVISOR,
          `plan: ${JSON.stringify(plan.agents)} — ${plan.rationale}`,
        ),
      ],
    };
  }

  private async runSynthesizer(state: CrewState): Promise<Partial<CrewState>> {
    const draftAnswer = await this.synthesizerAgent.synthesize({
      question: state.question,
      history: state.history,
      serviceMatches: state.serviceMatches,
      quoteMatches: state.quoteMatches,
      imageInsights: state.imageInsights,
    });
    return {
      draftAnswer,
      trace: [
        traceEntry(
          CREW_BACKBONE.SYNTHESIZE,
          `draft answer generated (${draftAnswer.length} chars)`,
        ),
      ],
    };
  }

  private async runPiiFilter(state: CrewState): Promise<Partial<CrewState>> {
    const result = await this.piiFilterService.filter(state.draftAnswer);
    return {
      finalAnswer: result.text,
      piiRedactions: result.redactions,
      trace: [
        traceEntry(
          CREW_BACKBONE.PII_FILTER,
          result.redactions.length > 0
            ? `redacted: ${result.redactions.join(', ')}`
            : 'no PII detected',
        ),
      ],
    };
  }

  private async runDispatch(state: CrewState): Promise<Partial<CrewState>> {
    const dispatch = await this.crewDispatchService.dispatch({
      question: state.question,
      answer: state.finalAnswer,
      conversationId: state.conversationId,
      userId: state.userId,
      channel: state.channel,
      piiRedactions: state.piiRedactions,
    });
    return {
      dispatch,
      trace: [
        traceEntry(
          CREW_BACKBONE.DISPATCH,
          `teamsSent=${dispatch.teamsSent}, websocketEmitted=${dispatch.websocketEmitted}`,
        ),
      ],
    };
  }
}
