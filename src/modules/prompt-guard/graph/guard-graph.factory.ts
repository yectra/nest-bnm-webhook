import { Injectable, Logger } from '@nestjs/common';
import { END, START, StateGraph } from '@langchain/langgraph';

import {
  InjectionAssessment,
  RetrievalVerdict,
} from '../interfaces/prompt-guard.interfaces';
import { HeuristicScanService } from '../services/heuristic-scan.service';
import { InjectionJudgeService } from '../services/injection-judge.service';
import { InjectionRetrievalService } from '../services/injection-retrieval.service';
import { InjectionScoringService } from '../services/injection-scoring.service';
import { GuardState, GuardStateAnnotation, guardTrace } from './guard-state';

/** Graph node names. Must not collide with state channel names. */
export const GUARD_NODES = {
  SCAN: 'scanHeuristics',
  RETRIEVE: 'retrieveSignatures',
  VOTE: 'voteKnn',
  JUDGE: 'llmJudge',
  DECIDE: 'decide',
} as const;

/** Minimal invocable surface of the compiled graph used by the guard service. */
export interface CompiledGuardGraph {
  invoke(input: Partial<GuardState>): Promise<GuardState>;
  getGraph(): { drawMermaid(): string };
}

/**
 * Registry-free wiring, so the builder is used through this untyped surface
 * instead of LangGraph's literal-type chaining (the crew factory does the same).
 */
interface DynamicGraphBuilder {
  addNode(
    name: string,
    fn: (
      state: GuardState,
    ) => Partial<GuardState> | Promise<Partial<GuardState>>,
  ): DynamicGraphBuilder;
  addEdge(from: string, to: string): DynamicGraphBuilder;
  addConditionalEdges(
    from: string,
    router: (state: GuardState) => string,
    targets: string[],
  ): DynamicGraphBuilder;
  compile(): CompiledGuardGraph;
}

const MAX_EXCERPT_TECHNIQUES = 3;

/**
 * Builds the compiled prompt-injection detection graph:
 *
 *   START -+-> scanHeuristics ----+
 *          +-> retrieveSignatures +-> voteKnn -+-> llmJudge -+-> decide -> END
 *                                              +--------------------+
 *
 * The pattern scan (no network) and the RAG retrieval (embed + Cosmos vector
 * query) run in the same superstep and fan back in at the vote node. The GPT-5
 * judge is skipped whenever the cheap signals already agree, which keeps the
 * common path to one embedding call plus one vector query.
 */
@Injectable()
export class GuardGraphFactory {
  private readonly logger = new Logger(GuardGraphFactory.name);

  constructor(
    private readonly heuristicScan: HeuristicScanService,
    private readonly retrieval: InjectionRetrievalService,
    private readonly scoring: InjectionScoringService,
    private readonly judge: InjectionJudgeService,
  ) {}

  build(): CompiledGuardGraph {
    const graph = new StateGraph(
      GuardStateAnnotation,
    ) as unknown as DynamicGraphBuilder;

    graph
      .addNode(GUARD_NODES.SCAN, (state) => this.runScan(state))
      .addNode(GUARD_NODES.RETRIEVE, (state) => this.runRetrieve(state))
      .addNode(GUARD_NODES.VOTE, (state) => this.runVote(state))
      .addNode(GUARD_NODES.JUDGE, (state) => this.runJudge(state))
      .addNode(GUARD_NODES.DECIDE, (state) => this.runDecide(state))
      .addEdge(START, GUARD_NODES.SCAN)
      .addEdge(START, GUARD_NODES.RETRIEVE)
      .addEdge(GUARD_NODES.SCAN, GUARD_NODES.VOTE)
      .addEdge(GUARD_NODES.RETRIEVE, GUARD_NODES.VOTE)
      .addConditionalEdges(
        GUARD_NODES.VOTE,
        (state) => this.routeFromVote(state),
        [GUARD_NODES.JUDGE, GUARD_NODES.DECIDE],
      )
      .addEdge(GUARD_NODES.JUDGE, GUARD_NODES.DECIDE)
      .addEdge(GUARD_NODES.DECIDE, END);

    this.logger.log(
      `Prompt-guard graph built (judge ${this.judge.isEnabled() ? 'enabled' : 'disabled'})`,
    );
    return graph.compile();
  }

  private runScan(state: GuardState): Partial<GuardState> {
    const { hits, score } = this.heuristicScan.scan(state.input);
    return {
      heuristics: hits,
      heuristicScore: score,
      trace: [
        guardTrace(
          GUARD_NODES.SCAN,
          hits.length > 0
            ? `${hits.length} pattern hit(s): ${hits.map((hit) => hit.rule).join(', ')}`
            : 'no deterministic patterns matched',
        ),
      ],
    };
  }

  private async runRetrieve(state: GuardState): Promise<Partial<GuardState>> {
    const outcome = await this.retrieval.retrieve(state.input);
    return {
      matches: outcome.matches,
      degraded: outcome.degraded,
      degradedReason: outcome.reason ?? null,
      trace: [
        guardTrace(
          GUARD_NODES.RETRIEVE,
          outcome.degraded
            ? `vector retrieval unavailable (${outcome.reason ?? 'unknown'})`
            : `${outcome.matches.length} signature neighbour(s), nearest similarity ${outcome.matches[0]?.similarity ?? 0}`,
        ),
      ],
    };
  }

  private runVote(state: GuardState): Partial<GuardState> {
    const verdict = this.scoring.vote(state.matches);
    return {
      retrieval: verdict,
      trace: [
        guardTrace(
          GUARD_NODES.VOTE,
          `k-NN injection vote ${verdict.score.toFixed(3)} x support ${verdict.support.toFixed(2)} = ${verdict.effectiveScore.toFixed(3)} (nearest injection ${verdict.nearestInjectionSimilarity.toFixed(3)}, nearest benign ${verdict.nearestBenignSimilarity.toFixed(3)})`,
        ),
      ],
    };
  }

  private routeFromVote(state: GuardState): string {
    if (!this.judge.isEnabled()) {
      return GUARD_NODES.DECIDE;
    }
    return this.scoring.needsJudge(
      state.retrieval?.effectiveScore ?? 0,
      state.heuristicScore,
      state.degraded,
    )
      ? GUARD_NODES.JUDGE
      : GUARD_NODES.DECIDE;
  }

  private async runJudge(state: GuardState): Promise<Partial<GuardState>> {
    const verdict = await this.judge.judge(state.input, state.matches);
    return {
      judgeVerdict: verdict,
      trace: [
        guardTrace(
          GUARD_NODES.JUDGE,
          verdict
            ? `judge says injection=${verdict.injection} (confidence ${verdict.confidence.toFixed(2)}): ${verdict.reason}`
            : 'judge unavailable, deciding without it',
        ),
      ],
    };
  }

  private runDecide(state: GuardState): Partial<GuardState> {
    const retrieval: RetrievalVerdict = state.retrieval ?? {
      score: 0,
      support: 0,
      effectiveScore: 0,
      nearestInjectionSimilarity: 0,
      nearestBenignSimilarity: 0,
      topTechnique: null,
      matches: state.matches,
    };
    const llmScore = this.scoring.judgeScore(state.judgeVerdict);
    const fused = this.scoring.fuse(
      retrieval.score,
      state.heuristicScore,
      llmScore,
    );
    const detected = fused >= this.scoring.config.decisionThreshold;
    const techniques = this.scoring.techniques(state.heuristics, retrieval);
    const riskLevel = this.scoring.riskLevel(
      detected,
      state.heuristics,
      retrieval,
    );

    const assessment: InjectionAssessment = {
      injectionDetected: detected,
      summary: this.summarize(detected, fused, techniques, state.degraded),
      confidence: Number((detected ? fused : 1 - fused).toFixed(3)),
      riskLevel,
      recommendation: this.scoring.recommendation(detected, fused),
      techniques,
      matches: retrieval.matches,
      heuristics: state.heuristics,
      signals: {
        retrieval: Number(retrieval.effectiveScore.toFixed(3)),
        retrievalVote: Number(retrieval.score.toFixed(3)),
        heuristic: Number(state.heuristicScore.toFixed(3)),
        llm: llmScore === null ? null : Number(llmScore.toFixed(3)),
      },
      judge: state.judgeVerdict,
      degraded: state.degraded,
      inspectedChars: state.input.length,
      trace: [],
    };

    return {
      assessment,
      trace: [
        guardTrace(
          GUARD_NODES.DECIDE,
          `fused score ${fused.toFixed(3)} -> injectionDetected=${detected}, risk=${riskLevel}, action=${assessment.recommendation}`,
        ),
      ],
    };
  }

  /** The plain-language answer the caller asked for. */
  private summarize(
    detected: boolean,
    score: number,
    techniques: string[],
    degraded: boolean,
  ): string {
    const suffix = degraded
      ? ' (signature index unavailable — verdict based on the pattern scan alone)'
      : '';
    if (!detected) {
      return `No prompt injection detected in the input${suffix}.`;
    }
    const named = techniques.slice(0, MAX_EXCERPT_TECHNIQUES).join(', ');
    return `Prompt injection detected (score ${score.toFixed(2)}${named ? `, technique: ${named}` : ''})${suffix}.`;
  }
}
