import { Module } from '@nestjs/common';

import { RequiredApiKeyGuard } from '../../common/guards/required-api-key.guard';
import { CosmosModule } from '../database/cosmos.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { GuardGraphFactory } from './graph/guard-graph.factory';
import { PromptGuardController } from './prompt-guard.controller';
import { PromptGuardService } from './prompt-guard.service';
import { GuardLlmProvider } from './services/guard-llm.provider';
import { HeuristicScanService } from './services/heuristic-scan.service';
import { InjectionCorpusService } from './services/injection-corpus.service';
import { InjectionJudgeService } from './services/injection-judge.service';
import { InjectionRetrievalService } from './services/injection-retrieval.service';
import { InjectionScoringService } from './services/injection-scoring.service';

/**
 * Prompt-injection guard: an HTTP event listener in front of a RAG detector
 * built on a Cosmos vector index of known prompt-injection messages
 * (text-embedding-3-small) and a LangGraph pipeline that fuses retrieval,
 * deterministic patterns and an optional GPT-5 judge.
 *
 * PromptGuardService is exported so other modules can screen untrusted text
 * before it reaches an LLM.
 */
@Module({
  imports: [CosmosModule, EmbeddingModule],
  controllers: [PromptGuardController],
  providers: [
    GuardLlmProvider,
    HeuristicScanService,
    InjectionScoringService,
    InjectionCorpusService,
    InjectionRetrievalService,
    InjectionJudgeService,
    GuardGraphFactory,
    PromptGuardService,
    RequiredApiKeyGuard,
  ],
  exports: [PromptGuardService],
})
export class PromptGuardModule {}
