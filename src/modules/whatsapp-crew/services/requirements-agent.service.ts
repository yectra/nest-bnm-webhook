import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CosmosRepository } from '../../chatbot/repositories/cosmos.repository';
import { VectorSearchService } from '../../chatbot/services/vector-search.service';
import { WhatsappRecordRetrievalAgent } from './record-retrieval-agent.base';

const REQUIREMENT_KEYWORDS =
  /\b(requirement|requirements|posted|post your requirements?|submission|submitted|request|enquiry|inquiry|need|looking for)\b/i;

/** Retrieval agent for the customer's Post Your Requirements submissions. */
@Injectable()
export class RequirementsAgentService extends WhatsappRecordRetrievalAgent {
  readonly name = 'requirementsAgent';
  readonly planKey = 'useRequirements';
  readonly planningHint =
    "look up the customer's Post Your Requirements submissions; true when " +
    'the message mentions a posted requirement, a submitted request, or a ' +
    'new need they are describing';
  readonly domain = 'requirements' as const;
  readonly matchChannel = 'requirementMatches' as const;

  protected readonly logger = new Logger(RequirementsAgentService.name);
  protected readonly container: string;
  protected readonly keywordPattern = REQUIREMENT_KEYWORDS;

  constructor(
    vectorSearchService: VectorSearchService,
    cosmosRepository: CosmosRepository,
    config: ConfigService,
  ) {
    super(
      vectorSearchService,
      cosmosRepository,
      config.get<number>('AGENT_CREW_TOP_K') ?? 5,
    );
    this.container =
      config.get<string>('AGENT_CREW_REQUIREMENTS_CONTAINER') ??
      'PostYourRequirements';
  }
}
