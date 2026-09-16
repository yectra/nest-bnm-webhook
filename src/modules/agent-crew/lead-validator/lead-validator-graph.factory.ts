import { Injectable, Logger } from '@nestjs/common';
import { StateGraph, START, END } from '@langchain/langgraph';
import {
  LeadValidatorStateAnnotation,
  LeadValidatorState,
} from './lead-validator.types';
import { TextModeratorNode } from './nodes/text-moderator.node';
import { VisionAnalystNode } from './nodes/vision-analyst.node';
import { EvaluatorNode } from './nodes/evaluator.node';

export interface CompiledLeadValidatorGraph {
  invoke(input: Partial<LeadValidatorState>): Promise<LeadValidatorState>;
}

@Injectable()
export class LeadValidatorGraphFactory {
  private readonly logger = new Logger(LeadValidatorGraphFactory.name);

  constructor(
    private readonly textModeratorNode: TextModeratorNode,
    private readonly visionAnalystNode: VisionAnalystNode,
    private readonly evaluatorNode: EvaluatorNode,
  ) {}

  build(): CompiledLeadValidatorGraph {
    const graph = new StateGraph(LeadValidatorStateAnnotation)
      .addNode('textModerator', (state: LeadValidatorState) =>
        this.textModeratorNode.run(state),
      )
      .addNode('visionAnalyst', (state: LeadValidatorState) =>
        this.visionAnalystNode.run(state),
      )
      .addNode('evaluator', (state: LeadValidatorState) =>
        this.evaluatorNode.run(state),
      )

      // Parallel execution for text and vision analysis
      .addEdge(START, 'textModerator')
      .addEdge(START, 'visionAnalyst')

      // Both must complete before evaluator runs
      .addEdge('textModerator', 'evaluator')
      .addEdge('visionAnalyst', 'evaluator')

      .addEdge('evaluator', END);

    this.logger.debug(
      'Lead Validator LangGraph built successfully with parallel text and vision branches.',
    );

    return graph.compile();
  }
}
