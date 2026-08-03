import { Injectable, Logger } from '@nestjs/common';
import { END, START, StateGraph } from '@langchain/langgraph';
import { CrewState, CrewStateAnnotation, traceEntry } from './crew-state';
import { SupervisorAgentService } from '../services/supervisor-agent.service';
import { ServiceVectorAgentService } from '../services/service-vector-agent.service';
import { QuoteAgentService } from '../services/quote-agent.service';
import { ImageAgentService } from '../services/image-agent.service';
import { SynthesizerAgentService } from '../services/synthesizer-agent.service';
import { PiiFilterService } from '../services/pii-filter.service';
import { CrewDispatchService } from '../services/crew-dispatch.service';

export const CREW_NODES = {
  SUPERVISOR: 'supervisor',
  SERVICES: 'serviceVectorAgent',
  QUOTES: 'quoteAgent',
  IMAGES: 'imageAgent',
  SYNTHESIZE: 'synthesize',
  PII_FILTER: 'piiFilter',
  // Note: node names must not collide with state channel names ("dispatch").
  DISPATCH: 'dispatchAgent',
} as const;

/**
 * Builds the compiled LangGraph crew:
 *
 *   START -> supervisor -+-> serviceVectorAgent -+
 *                        +-> quoteAgent ---------+-> synthesize -> piiFilter -> dispatch -> END
 *                        +-> imageAgent ---------+
 *
 * The retrieval agents selected by the supervisor run in parallel within one
 * superstep and fan back in at the synthesize node.
 */
@Injectable()
export class CrewGraphFactory {
  private readonly logger = new Logger(CrewGraphFactory.name);

  constructor(
    private readonly supervisorAgent: SupervisorAgentService,
    private readonly serviceVectorAgent: ServiceVectorAgentService,
    private readonly quoteAgent: QuoteAgentService,
    private readonly imageAgent: ImageAgentService,
    private readonly synthesizerAgent: SynthesizerAgentService,
    private readonly piiFilterService: PiiFilterService,
    private readonly crewDispatchService: CrewDispatchService,
  ) {}

  build() {
    const graph = new StateGraph(CrewStateAnnotation)
      .addNode(CREW_NODES.SUPERVISOR, (state: CrewState) =>
        this.runSupervisor(state),
      )
      .addNode(CREW_NODES.SERVICES, (state: CrewState) =>
        this.runServiceAgent(state),
      )
      .addNode(CREW_NODES.QUOTES, (state: CrewState) =>
        this.runQuoteAgent(state),
      )
      .addNode(CREW_NODES.IMAGES, (state: CrewState) =>
        this.runImageAgent(state),
      )
      .addNode(CREW_NODES.SYNTHESIZE, (state: CrewState) =>
        this.runSynthesizer(state),
      )
      .addNode(CREW_NODES.PII_FILTER, (state: CrewState) =>
        this.runPiiFilter(state),
      )
      .addNode(CREW_NODES.DISPATCH, (state: CrewState) =>
        this.runDispatch(state),
      )
      .addEdge(START, CREW_NODES.SUPERVISOR)
      .addConditionalEdges(
        CREW_NODES.SUPERVISOR,
        (state: CrewState) => this.routeFromSupervisor(state),
        [CREW_NODES.SERVICES, CREW_NODES.QUOTES, CREW_NODES.IMAGES],
      )
      .addEdge(CREW_NODES.SERVICES, CREW_NODES.SYNTHESIZE)
      .addEdge(CREW_NODES.QUOTES, CREW_NODES.SYNTHESIZE)
      .addEdge(CREW_NODES.IMAGES, CREW_NODES.SYNTHESIZE)
      .addEdge(CREW_NODES.SYNTHESIZE, CREW_NODES.PII_FILTER)
      .addEdge(CREW_NODES.PII_FILTER, CREW_NODES.DISPATCH)
      .addEdge(CREW_NODES.DISPATCH, END);

    return graph.compile();
  }

  private async runSupervisor(state: CrewState) {
    const plan = await this.supervisorAgent.plan(state.question);
    return {
      plan,
      trace: [
        traceEntry(
          CREW_NODES.SUPERVISOR,
          `plan: services=${plan.useServices}, quotes=${plan.useQuotes}, images=${plan.useImages} — ${plan.rationale}`,
        ),
      ],
    };
  }

  private routeFromSupervisor(state: CrewState): string[] {
    const plan = state.plan;
    const targets: string[] = [];
    if (!plan || plan.useServices) {
      targets.push(CREW_NODES.SERVICES);
    }
    if (plan?.useQuotes) {
      targets.push(CREW_NODES.QUOTES);
    }
    if (plan?.useImages) {
      targets.push(CREW_NODES.IMAGES);
    }
    if (targets.length === 0) {
      targets.push(CREW_NODES.SERVICES);
    }
    return targets;
  }

  private async runServiceAgent(state: CrewState) {
    const serviceMatches = await this.serviceVectorAgent.retrieve(
      state.question,
      state.userId,
    );
    return {
      serviceMatches,
      trace: [
        traceEntry(
          CREW_NODES.SERVICES,
          `retrieved ${serviceMatches.length} service vector matches`,
        ),
      ],
    };
  }

  private async runQuoteAgent(state: CrewState) {
    const quoteMatches = await this.quoteAgent.retrieve(
      state.question,
      state.userId,
    );
    return {
      quoteMatches,
      trace: [
        traceEntry(
          CREW_NODES.QUOTES,
          `retrieved ${quoteMatches.length} quote records`,
        ),
      ],
    };
  }

  private async runImageAgent(state: CrewState) {
    const imageInsights = await this.imageAgent.analyze(
      state.question,
      state.userId,
    );
    return {
      imageInsights,
      trace: [
        traceEntry(
          CREW_NODES.IMAGES,
          `analyzed ${imageInsights.length} attached pictures`,
        ),
      ],
    };
  }

  private async runSynthesizer(state: CrewState) {
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
          CREW_NODES.SYNTHESIZE,
          `draft answer generated (${draftAnswer.length} chars)`,
        ),
      ],
    };
  }

  private async runPiiFilter(state: CrewState) {
    const result = await this.piiFilterService.filter(state.draftAnswer);
    return {
      finalAnswer: result.text,
      piiRedactions: result.redactions,
      trace: [
        traceEntry(
          CREW_NODES.PII_FILTER,
          result.redactions.length > 0
            ? `redacted: ${result.redactions.join(', ')}`
            : 'no PII detected',
        ),
      ],
    };
  }

  private async runDispatch(state: CrewState) {
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
          CREW_NODES.DISPATCH,
          `teamsSent=${dispatch.teamsSent}, websocketEmitted=${dispatch.websocketEmitted}`,
        ),
      ],
    };
  }
}
