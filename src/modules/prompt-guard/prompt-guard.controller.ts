import { Body, Controller, Get, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { RequiredApiKeyGuard } from '../../common/guards/required-api-key.guard';
import { DetectInjectionDto } from './dto/detect-injection.dto';
import { GuardEventDto } from './dto/guard-event.dto';
import { SeedCorpusDto } from './dto/seed-corpus.dto';
import { InjectionAssessment } from './interfaces/prompt-guard.interfaces';
import {
  GuardEventBatchResult,
  PromptGuardService,
  SubscriptionValidationResponse,
} from './prompt-guard.service';
import {
  InjectionCorpusService,
  SeedResult,
} from './services/injection-corpus.service';

@ApiTags('prompt-guard')
@Controller('prompt-guard')
export class PromptGuardController {
  private readonly logger = new Logger(PromptGuardController.name);

  constructor(
    private readonly promptGuardService: PromptGuardService,
    private readonly corpusService: InjectionCorpusService,
  ) {}

  /**
   * Event listener. Producers (Event Grid, the Java service, an internal
   * webhook) post the message they are about to hand to an LLM; the response
   * says whether it contains a prompt injection.
   */
  @Public()
  @Post('events')
  @ApiOperation({
    summary: 'Inspect an inbound event for prompt injection',
    description:
      'Accepts a single event or an Event Grid batch. Answers the Event Grid subscription ' +
      'validation handshake, otherwise extracts the message text from each event and runs the ' +
      'LangGraph RAG detector: pattern scan and text-embedding-3-small retrieval over the known ' +
      'prompt-injection corpus in parallel, a weighted k-NN vote, then a GPT-5 judge when the ' +
      'cheap signals are inconclusive.',
  })
  @ApiBody({ type: GuardEventDto })
  async receiveEvent(
    @Body() body: unknown,
  ): Promise<GuardEventBatchResult | SubscriptionValidationResponse> {
    return this.promptGuardService.handleEvent(body);
  }

  /** Direct, synchronous check for callers that already have the text. */
  @Public()
  @Post('detect')
  @ApiOperation({
    summary: 'Check one piece of text for prompt injection',
    description:
      'Returns injectionDetected plus the retrieved corpus neighbours, the deterministic ' +
      'pattern hits, the fused confidence and a recommended action (allow / review / block).',
  })
  detect(@Body() dto: DetectInjectionDto): Promise<InjectionAssessment> {
    return this.promptGuardService.inspect(dto.text, dto.source ?? 'api');
  }

  /** Corpus composition and how much of it is indexed right now. */
  @Public()
  @Get('signatures')
  @ApiOperation({ summary: 'Prompt-injection corpus and vector index status' })
  signatures(): Promise<Record<string, unknown>> {
    return this.corpusService.stats();
  }

  /** Mermaid rendering of the compiled detector graph. */
  @Public()
  @Get('graph')
  @ApiOperation({ summary: 'Mermaid diagram of the compiled detector graph' })
  graph(): { mermaid: string } {
    return { mermaid: this.promptGuardService.describeGraph() };
  }

  /**
   * Build or refresh the vector database. Administrative: it creates the
   * container and spends embedding calls, so it is API-key protected like the
   * other embedding operations.
   */
  @Post('signatures/seed')
  @UseGuards(RequiredApiKeyGuard)
  @ApiHeader({ name: 'x-api-key', required: true })
  @ApiOperation({
    summary: 'Seed the prompt-injection vector index',
    description:
      'Creates the DiskANN/cosine container if needed and upserts every corpus entry embedded ' +
      'with text-embedding-3-small. Idempotent: unchanged entries are skipped unless force=true.',
  })
  seed(@Body() dto: SeedCorpusDto): Promise<SeedResult> {
    this.logger.log(
      `Seeding prompt-injection corpus (force=${dto.force === true})`,
    );
    return this.corpusService.seed(dto.force === true);
  }
}
