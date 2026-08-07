import { Inject, Injectable, Logger } from '@nestjs/common';
import { CrewLlmProvider } from '../../agent-crew/services/crew-llm.provider';
import { VectorSearchResult } from '../../chatbot/interfaces/vector-search.interface';
import {
  AttributionDomain,
  ResponseAttribution,
} from '../interfaces/whatsapp-crew.interfaces';
import {
  WHATSAPP_CREW_AGENTS,
  WhatsappCrewAgentDefinition,
} from '../graph/whatsapp-crew-agent.definition';
import { WhatsappCrewState } from '../graph/whatsapp-crew-state';
import { ATTRIBUTION_SYSTEM_PROMPT } from '../prompts/whatsapp-crew.prompts';

interface AttributionCandidate {
  domain: AttributionDomain;
  record: VectorSearchResult;
}

const VALID_DOMAINS: AttributionDomain[] = [
  'project',
  'quote',
  'requirements',
  'feedback',
  'general',
];

/**
 * Attribution judge: after the retrieval agents fan back in, decides which
 * customer journey (project / quote / Post Your Requirements / feedback) and
 * which specific record the inbound WhatsApp message should be attributed to,
 * so the reply is written in the right context. Falls back to a
 * best-similarity heuristic when the LLM is unavailable.
 */
@Injectable()
export class AttributionAgentService {
  private readonly logger = new Logger(AttributionAgentService.name);

  constructor(
    private readonly llm: CrewLlmProvider,
    @Inject(WHATSAPP_CREW_AGENTS)
    private readonly agents: WhatsappCrewAgentDefinition[],
  ) {}

  async attribute(state: WhatsappCrewState): Promise<ResponseAttribution> {
    const candidates = this.collectCandidates(state);
    const fallback = this.heuristicAttribution(candidates);

    if (candidates.length === 0) {
      return fallback;
    }

    const parsed = await this.llm.completeJson<Record<string, unknown>>(
      ATTRIBUTION_SYSTEM_PROMPT,
      this.buildUserPrompt(state.question, candidates),
    );

    if (!parsed) {
      this.logger.warn(
        'Attribution LLM unavailable, using best-similarity heuristic',
      );
      return fallback;
    }

    return this.sanitize(parsed, candidates, fallback);
  }

  collectCandidates(state: WhatsappCrewState): AttributionCandidate[] {
    const candidates: AttributionCandidate[] = [];
    for (const agent of this.agents) {
      const matches = state[agent.matchChannel] ?? [];
      for (const record of matches) {
        candidates.push({ domain: agent.domain, record });
      }
    }
    return candidates;
  }

  heuristicAttribution(
    candidates: AttributionCandidate[],
  ): ResponseAttribution {
    if (candidates.length === 0) {
      return {
        domain: 'general',
        recordId: null,
        recordContainer: null,
        confidence: 0.3,
        rationale:
          'No customer records matched; responding with general guidance.',
      };
    }

    const best = candidates.reduce((left, right) =>
      (right.record.similarity ?? 0) > (left.record.similarity ?? 0)
        ? right
        : left,
    );
    return {
      domain: best.domain,
      recordId: best.record.id,
      recordContainer: best.record.sourceContainer ?? null,
      confidence: Math.max(0, Math.min(1, best.record.similarity ?? 0.5)),
      rationale: `Best-similarity heuristic matched a ${best.domain} record.`,
    };
  }

  private buildUserPrompt(
    question: string,
    candidates: AttributionCandidate[],
  ): string {
    const lines = candidates.map(({ domain, record }) => {
      const snippet = JSON.stringify(record.sourceData ?? {}).slice(0, 400);
      return `- domain=${domain}, recordId=${record.id}, container=${record.sourceContainer}, similarity=${(record.similarity ?? 0).toFixed(2)}, data=${snippet}`;
    });

    return `Customer WhatsApp message:\n${question}\n\nCandidate records:\n${lines.join('\n')}`;
  }

  private sanitize(
    parsed: Record<string, unknown>,
    candidates: AttributionCandidate[],
    fallback: ResponseAttribution,
  ): ResponseAttribution {
    const domain = VALID_DOMAINS.includes(parsed.domain as AttributionDomain)
      ? (parsed.domain as AttributionDomain)
      : fallback.domain;

    let recordId: string | null = null;
    let recordContainer: string | null = null;
    if (typeof parsed.recordId === 'string' && parsed.recordId.length > 0) {
      const candidate = candidates.find(
        ({ record }) => record.id === parsed.recordId,
      );
      if (candidate) {
        recordId = candidate.record.id;
        recordContainer = candidate.record.sourceContainer ?? null;
      }
    }

    const confidence =
      typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : fallback.confidence;

    return {
      domain,
      recordId,
      recordContainer,
      confidence,
      rationale:
        typeof parsed.rationale === 'string' && parsed.rationale.length > 0
          ? parsed.rationale
          : fallback.rationale,
    };
  }
}
