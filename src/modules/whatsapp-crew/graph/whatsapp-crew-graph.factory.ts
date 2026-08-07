import { Inject, Injectable, Logger } from '@nestjs/common';
import { END, START, StateGraph } from '@langchain/langgraph';
import {
  WhatsappCrewState,
  WhatsappCrewStateAnnotation,
  waTraceEntry,
} from './whatsapp-crew-state';
import {
  WHATSAPP_CREW_AGENTS,
  WhatsappCrewAgentDefinition,
} from './whatsapp-crew-agent.definition';
import { MediaIntakeService } from '../services/media-intake.service';
import { WhatsappSupervisorService } from '../services/whatsapp-supervisor.service';
import { AttributionAgentService } from '../services/attribution-agent.service';
import { WhatsappReplySynthesizerService } from '../services/whatsapp-reply-synthesizer.service';
import { PiiFilterService } from '../../agent-crew/services/pii-filter.service';
import { WhatsappDispatchService } from '../services/whatsapp-dispatch.service';

/**
 * Fixed backbone nodes. The retrieval slots between supervisor and
 * attribution come from the WHATSAPP_CREW_AGENTS registry; the tail is
 * deliberately hardcoded so no reply can skip attribution or PII filtering
 * before it is sent to the customer.
 * Note: node names must not collide with state channel names ("dispatch").
 */
export const WHATSAPP_CREW_BACKBONE = {
  INTAKE: 'intake',
  SUPERVISOR: 'supervisor',
  ATTRIBUTION: 'attributionAgent',
  SYNTHESIZE: 'synthesize',
  PII_FILTER: 'piiFilter',
  DISPATCH: 'dispatchAgent',
} as const;

/** Minimal invocable surface of the compiled graph used by the crew service. */
export interface CompiledWhatsappCrewGraph {
  invoke(input: Partial<WhatsappCrewState>): Promise<WhatsappCrewState>;
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
    fn: (state: WhatsappCrewState) => Promise<Partial<WhatsappCrewState>>,
  ): DynamicGraphBuilder;
  addEdge(from: string, to: string): DynamicGraphBuilder;
  addConditionalEdges(
    from: string,
    router: (state: WhatsappCrewState) => string[],
    targets: string[],
  ): DynamicGraphBuilder;
  compile(): CompiledWhatsappCrewGraph;
}

/**
 * Builds the compiled WhatsApp LangGraph crew:
 *
 *   START -> intake -> supervisor -+-> [registered agent 0] -+
 *                                  +-> [registered agent 1] -+-> attributionAgent
 *                                  +-> [registered agent n] -+        |
 *                                                                     v
 *                            END <- dispatchAgent <- piiFilter <- synthesize
 *
 * Retrieval agents come from the WHATSAPP_CREW_AGENTS registry: each is a
 * node, an edge into attributionAgent, a conditional-routing target, and a
 * line in the supervisor's planning prompt. The agents selected by the
 * supervisor run in parallel within one superstep and fan back in at the
 * attribution node, which decides which customer journey the reply should be
 * attributed to.
 */
@Injectable()
export class WhatsappCrewGraphFactory {
  private readonly logger = new Logger(WhatsappCrewGraphFactory.name);

  constructor(
    @Inject(WHATSAPP_CREW_AGENTS)
    private readonly agents: WhatsappCrewAgentDefinition[],
    private readonly mediaIntakeService: MediaIntakeService,
    private readonly supervisorService: WhatsappSupervisorService,
    private readonly attributionAgent: AttributionAgentService,
    private readonly replySynthesizer: WhatsappReplySynthesizerService,
    private readonly piiFilterService: PiiFilterService,
    private readonly dispatchService: WhatsappDispatchService,
  ) {}

  build(): CompiledWhatsappCrewGraph {
    this.assertNodeNames();

    const graph = new StateGraph(
      WhatsappCrewStateAnnotation,
    ) as unknown as DynamicGraphBuilder;

    graph
      .addNode(WHATSAPP_CREW_BACKBONE.INTAKE, (state) => this.runIntake(state))
      .addNode(WHATSAPP_CREW_BACKBONE.SUPERVISOR, (state) =>
        this.runSupervisor(state),
      )
      .addNode(WHATSAPP_CREW_BACKBONE.ATTRIBUTION, (state) =>
        this.runAttribution(state),
      )
      .addNode(WHATSAPP_CREW_BACKBONE.SYNTHESIZE, (state) =>
        this.runSynthesizer(state),
      )
      .addNode(WHATSAPP_CREW_BACKBONE.PII_FILTER, (state) =>
        this.runPiiFilter(state),
      )
      .addNode(WHATSAPP_CREW_BACKBONE.DISPATCH, (state) =>
        this.runDispatch(state),
      )
      .addEdge(START, WHATSAPP_CREW_BACKBONE.INTAKE)
      .addEdge(
        WHATSAPP_CREW_BACKBONE.INTAKE,
        WHATSAPP_CREW_BACKBONE.SUPERVISOR,
      );

    for (const agent of this.agents) {
      graph
        .addNode(agent.name, (state) => agent.run(state))
        .addEdge(agent.name, WHATSAPP_CREW_BACKBONE.ATTRIBUTION);
    }

    graph
      .addConditionalEdges(
        WHATSAPP_CREW_BACKBONE.SUPERVISOR,
        (state) => this.routeFromSupervisor(state),
        this.agents.map((agent) => agent.name),
      )
      .addEdge(
        WHATSAPP_CREW_BACKBONE.ATTRIBUTION,
        WHATSAPP_CREW_BACKBONE.SYNTHESIZE,
      )
      .addEdge(
        WHATSAPP_CREW_BACKBONE.SYNTHESIZE,
        WHATSAPP_CREW_BACKBONE.PII_FILTER,
      )
      .addEdge(
        WHATSAPP_CREW_BACKBONE.PII_FILTER,
        WHATSAPP_CREW_BACKBONE.DISPATCH,
      )
      .addEdge(WHATSAPP_CREW_BACKBONE.DISPATCH, END);

    this.logger.log(
      `WhatsApp crew graph built with ${this.agents.length} registered agents: ${this.agents
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
    const channels = new Set(
      Object.keys(WhatsappCrewStateAnnotation.spec ?? {}),
    );
    const reserved = new Set<string>(Object.values(WHATSAPP_CREW_BACKBONE));
    const seen = new Set<string>();

    for (const agent of this.agents) {
      if (channels.has(agent.name)) {
        throw new Error(
          `WhatsApp crew agent node "${agent.name}" collides with a state channel name`,
        );
      }
      if (reserved.has(agent.name)) {
        throw new Error(
          `WhatsApp crew agent node "${agent.name}" collides with a backbone node name`,
        );
      }
      if (seen.has(agent.name)) {
        throw new Error(
          `Duplicate WhatsApp crew agent node name "${agent.name}"`,
        );
      }
      seen.add(agent.name);
    }
  }

  private routeFromSupervisor(state: WhatsappCrewState): string[] {
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

  private async runIntake(
    state: WhatsappCrewState,
  ): Promise<Partial<WhatsappCrewState>> {
    if (!state.message) {
      return {
        question: state.question,
        trace: [
          waTraceEntry(WHATSAPP_CREW_BACKBONE.INTAKE, 'no message on state'),
        ],
      };
    }
    const result = await this.mediaIntakeService.intake(state.message);
    return {
      question: result.question,
      mediaInsights: result.mediaInsights,
      trace: [
        waTraceEntry(
          WHATSAPP_CREW_BACKBONE.INTAKE,
          `type=${state.message.messageType}, mediaInsights=${result.mediaInsights.length}`,
        ),
      ],
    };
  }

  private async runSupervisor(
    state: WhatsappCrewState,
  ): Promise<Partial<WhatsappCrewState>> {
    const plan = await this.supervisorService.plan(state.question);
    return {
      plan,
      trace: [
        waTraceEntry(
          WHATSAPP_CREW_BACKBONE.SUPERVISOR,
          `plan: ${JSON.stringify(plan.agents)} — ${plan.rationale}`,
        ),
      ],
    };
  }

  private async runAttribution(
    state: WhatsappCrewState,
  ): Promise<Partial<WhatsappCrewState>> {
    const attribution = await this.attributionAgent.attribute(state);
    return {
      attribution,
      trace: [
        waTraceEntry(
          WHATSAPP_CREW_BACKBONE.ATTRIBUTION,
          `domain=${attribution.domain}, recordId=${attribution.recordId ?? 'none'}, confidence=${attribution.confidence.toFixed(2)} — ${attribution.rationale}`,
        ),
      ],
    };
  }

  private async runSynthesizer(
    state: WhatsappCrewState,
  ): Promise<Partial<WhatsappCrewState>> {
    const draftReply = await this.replySynthesizer.synthesize(state);
    return {
      draftReply,
      trace: [
        waTraceEntry(
          WHATSAPP_CREW_BACKBONE.SYNTHESIZE,
          `draft reply generated (${draftReply.length} chars)`,
        ),
      ],
    };
  }

  private async runPiiFilter(
    state: WhatsappCrewState,
  ): Promise<Partial<WhatsappCrewState>> {
    const result = await this.piiFilterService.filter(state.draftReply);
    return {
      finalReply: result.text,
      piiRedactions: result.redactions,
      trace: [
        waTraceEntry(
          WHATSAPP_CREW_BACKBONE.PII_FILTER,
          result.redactions.length > 0
            ? `redacted: ${result.redactions.join(', ')}`
            : 'no PII detected',
        ),
      ],
    };
  }

  private async runDispatch(
    state: WhatsappCrewState,
  ): Promise<Partial<WhatsappCrewState>> {
    const dispatch = await this.dispatchService.dispatch({
      to: state.message?.from ?? '',
      reply: state.finalReply,
      conversationId: state.conversationId,
    });
    return {
      dispatch,
      trace: [
        waTraceEntry(
          WHATSAPP_CREW_BACKBONE.DISPATCH,
          `whatsappSent=${dispatch.whatsappSent}${dispatch.messageSid ? `, sid=${dispatch.messageSid}` : ''}${dispatch.error ? `, error=${dispatch.error}` : ''}`,
        ),
      ],
    };
  }
}
