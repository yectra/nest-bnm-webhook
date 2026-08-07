import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CosmosRepository } from '../../chatbot/repositories/cosmos.repository';
import { VectorSearchService } from '../../chatbot/services/vector-search.service';
import { WhatsappRecordRetrievalAgent } from './record-retrieval-agent.base';

const PROJECT_KEYWORDS =
  /\b(project|projects|renovation|site|timeline|milestone|progress|status|work started|completion|handover)\b/i;

/** Retrieval agent for the customer's project details. */
@Injectable()
export class ProjectDetailsAgentService extends WhatsappRecordRetrievalAgent {
  readonly name = 'projectAgent';
  readonly planKey = 'useProjects';
  readonly planningHint =
    "look up the customer's projects (status, timeline, milestones, site " +
    'work); true when the message mentions a project, renovation, progress, ' +
    'or ongoing work';
  readonly domain = 'project' as const;
  readonly matchChannel = 'projectMatches' as const;

  protected readonly logger = new Logger(ProjectDetailsAgentService.name);
  protected readonly container: string;
  protected readonly keywordPattern = PROJECT_KEYWORDS;

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
      config.get<string>('WHATSAPP_CREW_PROJECT_CONTAINER') ?? 'Project';
  }
}
