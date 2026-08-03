import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VectorSearchService } from '../../chatbot/services/vector-search.service';
import { VectorSearchResult } from '../../chatbot/interfaces/vector-search.interface';
import { CrewAgentDefinition } from '../graph/crew-agent.definition';
import { CrewState, traceEntry } from '../graph/crew-state';

/**
 * Retrieval agent for the service catalog. Runs Cosmos DB vector search over
 * the embedded documents projection and prefers matches that originate from
 * the Service container.
 */
@Injectable()
export class ServiceVectorAgentService implements CrewAgentDefinition {
  readonly name = 'serviceVectorAgent';
  readonly planKey = 'useServices';
  readonly planningHint =
    'search the service catalog vector index; true unless the question is ' +
    "exclusively about the user's own quotes or pictures";

  private readonly logger = new Logger(ServiceVectorAgentService.name);
  private readonly topK: number;

  constructor(
    private readonly vectorSearchService: VectorSearchService,
    config: ConfigService,
  ) {
    this.topK = config.get<number>('AGENT_CREW_TOP_K') ?? 5;
  }

  enabled(): boolean {
    return true;
  }

  planHeuristic(): boolean {
    // Catalog retrieval is the safe default for any question.
    return true;
  }

  async run(state: CrewState): Promise<Partial<CrewState>> {
    const serviceMatches = await this.retrieve(state.question, state.userId);
    return {
      serviceMatches,
      trace: [
        traceEntry(
          this.name,
          `retrieved ${serviceMatches.length} service vector matches`,
        ),
      ],
    };
  }

  async retrieve(
    question: string,
    userId?: string,
  ): Promise<VectorSearchResult[]> {
    const matches = await this.vectorSearchService.search(
      question,
      null,
      userId,
    );

    const serviceMatches = matches.filter((match) =>
      /service/i.test(match.sourceContainer ?? ''),
    );

    // If nothing came back tagged as a Service document, keep the general
    // matches so the synthesizer still has catalog context to work with.
    const selected = serviceMatches.length > 0 ? serviceMatches : matches;
    this.logger.log(
      `Service vector agent: ${selected.length}/${matches.length} matches selected`,
    );
    return selected.slice(0, this.topK);
  }
}
