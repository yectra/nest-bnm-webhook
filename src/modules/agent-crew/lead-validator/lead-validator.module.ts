import { Module } from '@nestjs/common';
import { TextModeratorNode } from './nodes/text-moderator.node';
import { VisionAnalystNode } from './nodes/vision-analyst.node';
import { EvaluatorNode } from './nodes/evaluator.node';
import { LeadValidatorGraphFactory } from './lead-validator-graph.factory';
import { LeadValidatorService } from './lead-validator.service';
import { CrewLlmProvider } from '../services/crew-llm.provider';
import { MediaPreprocessorService } from './services/media-preprocessor.service';

@Module({
  providers: [
    MediaPreprocessorService,
    TextModeratorNode,
    VisionAnalystNode,
    EvaluatorNode,
    LeadValidatorGraphFactory,
    LeadValidatorService,
    CrewLlmProvider,
  ],
  exports: [LeadValidatorService, MediaPreprocessorService],
})
export class LeadValidatorModule {}
