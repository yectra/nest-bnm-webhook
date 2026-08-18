import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  GuardRecommendation,
  HeuristicHit,
  InjectionSeverity,
  InjectionTechnique,
  JudgeVerdict,
  RetrievalVerdict,
  SignatureMatch,
} from '../interfaces/prompt-guard.interfaces';
import { SEVERITY_RANK } from './heuristic-scan.service';

/** Tunables, all overridable through the environment. */
export interface ScoringConfig {
  /** Similarity below which a neighbour is ignored entirely. */
  minSimilarity: number;
  /** A neighbour this close to a known injection decides the case on its own. */
  highSimilarity: number;
  /** Fused score at or above this is reported as an injection. */
  decisionThreshold: number;
  /** Half-width of the uncertainty band that escalates to the LLM judge. */
  judgeBand: number;
}

const DEFAULTS: ScoringConfig = {
  minSimilarity: 0.45,
  highSimilarity: 0.86,
  decisionThreshold: 0.6,
  judgeBand: 0.18,
};

/**
 * How much of a signal's own confidence survives pooling. Both signals are
 * high-precision positive evidence, so they are pooled with a noisy-OR rather
 * than averaged: a silent pattern scan means "this rule set saw nothing", not
 * "this input is safe". Averaging would let a missing pattern hit cap a
 * confident retrieval match below the decision threshold — and the pattern
 * rules only cover about half of the corpus by design.
 */
const RELIABILITY = { retrieval: 0.95, heuristic: 0.9 };

/**
 * The judge sees the full input plus the retrieved evidence, so it is allowed
 * to pull the verdict in either direction — it is averaged against the pooled
 * cheap signals rather than pooled with them.
 */
const JUDGE_WEIGHT = 0.45;

/** Floor on the retrieval damping, so a weak-similarity vote still counts. */
const MIN_SUPPORT_FACTOR = 0.5;

/**
 * Pure decision logic for the detector: the weighted k-NN vote over retrieved
 * signatures, and the fusion of retrieval / heuristic / judge signals into the
 * final verdict. Kept free of I/O so it is unit-testable without Azure.
 */
@Injectable()
export class InjectionScoringService {
  readonly config: ScoringConfig;

  constructor(config?: ConfigService) {
    this.config = {
      minSimilarity:
        this.num(config, 'PROMPT_GUARD_MIN_SIMILARITY') ??
        DEFAULTS.minSimilarity,
      highSimilarity:
        this.num(config, 'PROMPT_GUARD_HIGH_SIMILARITY') ??
        DEFAULTS.highSimilarity,
      decisionThreshold:
        this.num(config, 'PROMPT_GUARD_DECISION_THRESHOLD') ??
        DEFAULTS.decisionThreshold,
      judgeBand:
        this.num(config, 'PROMPT_GUARD_JUDGE_BAND') ?? DEFAULTS.judgeBand,
    };
  }

  /**
   * Weighted k-NN vote. Each neighbour above the similarity floor votes for its
   * own label with a weight that grows quadratically with similarity, so a
   * near-duplicate outvotes a crowd of loose matches. Injection votes are
   * additionally weighted by severity.
   */
  vote(matches: SignatureMatch[]): RetrievalVerdict {
    const usable = matches
      .filter((match) => match.similarity >= this.config.minSimilarity)
      .sort((a, b) => b.similarity - a.similarity);

    const nearestInjectionSimilarity = this.nearest(matches, 'injection');
    const nearestBenignSimilarity = this.nearest(matches, 'benign');

    if (usable.length === 0) {
      return {
        score: 0,
        support: 0,
        effectiveScore: 0,
        nearestInjectionSimilarity,
        nearestBenignSimilarity,
        topTechnique: null,
        matches,
      };
    }

    let injectionWeight = 0;
    let totalWeight = 0;
    const techniqueWeight = new Map<InjectionTechnique, number>();

    for (const match of usable) {
      const base = (match.similarity - this.config.minSimilarity) ** 2;
      if (base <= 0) {
        continue;
      }
      if (match.label === 'injection') {
        const weighted = base * (0.6 + 0.1 * SEVERITY_RANK[match.severity]);
        injectionWeight += weighted;
        totalWeight += weighted;
        techniqueWeight.set(
          match.technique,
          (techniqueWeight.get(match.technique) ?? 0) + weighted,
        );
      } else {
        totalWeight += base;
      }
    }

    const rawScore = totalWeight === 0 ? 0 : injectionWeight / totalWeight;
    // A near-duplicate of a known attack is decisive regardless of the vote.
    const score =
      nearestInjectionSimilarity >= this.config.highSimilarity
        ? Math.max(rawScore, 0.95)
        : rawScore;

    const topTechnique =
      [...techniqueWeight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      null;

    const support = this.support(nearestInjectionSimilarity);
    return {
      score,
      support,
      effectiveScore:
        score * (MIN_SUPPORT_FACTOR + (1 - MIN_SUPPORT_FACTOR) * support),
      nearestInjectionSimilarity,
      nearestBenignSimilarity,
      topTechnique,
      matches,
    };
  }

  /**
   * How far the nearest known injection sits between the similarity floor (no
   * evidence) and the near-duplicate threshold (decisive evidence).
   */
  private support(nearestInjectionSimilarity: number): number {
    const span = this.config.highSimilarity - this.config.minSimilarity;
    if (span <= 0) {
      return 1;
    }
    return this.clamp(
      (nearestInjectionSimilarity - this.config.minSimilarity) / span,
    );
  }

  /**
   * Should the GPT-5 judge run? Only when the cheap signals are not decisive:
   * the fused score sits in the uncertainty band, or retrieval and heuristics
   * disagree with each other.
   */
  needsJudge(
    retrievalScore: number,
    heuristicScore: number,
    degraded: boolean,
  ): boolean {
    if (degraded) {
      // Retrieval is unavailable, so the judge is the only second opinion.
      return true;
    }
    const { decisionThreshold, judgeBand } = this.config;
    const fused = this.fuse(retrievalScore, heuristicScore, null);
    const inBand = Math.abs(fused - decisionThreshold) <= judgeBand;
    const disagree =
      Math.abs(retrievalScore - heuristicScore) >= 0.5 &&
      (retrievalScore >= decisionThreshold ||
        heuristicScore >= decisionThreshold);
    return inBand || disagree;
  }

  /**
   * Fuse the available signals into a single 0..1 score: retrieval and the
   * pattern scan are pooled as independent positive evidence, then the judge —
   * when it ran — is averaged in as a two-way adjudicator.
   */
  fuse(
    retrievalScore: number,
    heuristicScore: number,
    llmScore: number | null,
  ): number {
    const pooled = this.clamp(
      1 -
        (1 - this.clamp(retrievalScore) * RELIABILITY.retrieval) *
          (1 - this.clamp(heuristicScore) * RELIABILITY.heuristic),
    );
    if (llmScore === null) {
      return pooled;
    }
    return this.clamp(
      pooled * (1 - JUDGE_WEIGHT) + this.clamp(llmScore) * JUDGE_WEIGHT,
    );
  }

  /** Signed judge score: 0 when it says clean, up to 1 when it says injection. */
  judgeScore(judge: JudgeVerdict | null): number | null {
    if (!judge) {
      return null;
    }
    const confidence = this.clamp(judge.confidence);
    return judge.injection ? confidence : 1 - confidence;
  }

  /** Highest severity implied by the evidence that actually fired. */
  riskLevel(
    detected: boolean,
    hits: HeuristicHit[],
    verdict: RetrievalVerdict,
  ): InjectionSeverity {
    if (!detected) {
      return 'none';
    }
    const severities: InjectionSeverity[] = [
      ...hits.map((hit) => hit.severity),
      ...verdict.matches
        .filter(
          (match) =>
            match.label === 'injection' &&
            match.similarity >= this.config.minSimilarity,
        )
        .map((match) => match.severity),
    ];
    return severities.reduce<InjectionSeverity>(
      (worst, current) =>
        SEVERITY_RANK[current] > SEVERITY_RANK[worst] ? current : worst,
      'low',
    );
  }

  /** Block on a confident detection, ask for review when it is borderline. */
  recommendation(detected: boolean, score: number): GuardRecommendation {
    if (detected) {
      return score >= this.config.decisionThreshold + this.config.judgeBand
        ? 'block'
        : 'review';
    }
    return score >= this.config.decisionThreshold - this.config.judgeBand
      ? 'review'
      : 'allow';
  }

  /** Distinct techniques implicated by the firing evidence, worst-first. */
  techniques(
    hits: HeuristicHit[],
    verdict: RetrievalVerdict,
  ): InjectionTechnique[] {
    const ranked = new Map<InjectionTechnique, number>();
    for (const hit of hits) {
      ranked.set(
        hit.technique,
        Math.max(ranked.get(hit.technique) ?? 0, SEVERITY_RANK[hit.severity]),
      );
    }
    for (const match of verdict.matches) {
      if (
        match.label !== 'injection' ||
        match.similarity < this.config.minSimilarity
      ) {
        continue;
      }
      ranked.set(
        match.technique,
        Math.max(
          ranked.get(match.technique) ?? 0,
          SEVERITY_RANK[match.severity],
        ),
      );
    }
    return [...ranked.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([technique]) => technique);
  }

  private nearest(
    matches: SignatureMatch[],
    label: SignatureMatch['label'],
  ): number {
    const similarities = matches
      .filter((match) => match.label === label)
      .map((match) => match.similarity);
    return similarities.length > 0 ? Math.max(...similarities) : 0;
  }

  private clamp(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.min(Math.max(value, 0), 1);
  }

  private num(
    config: ConfigService | undefined,
    key: string,
  ): number | undefined {
    const raw = config?.get<number | string>(key);
    if (raw === undefined || raw === null || raw === '') {
      return undefined;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
}
