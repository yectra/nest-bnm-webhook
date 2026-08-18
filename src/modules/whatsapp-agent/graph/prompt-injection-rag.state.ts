import { Annotation } from '@langchain/langgraph';

import type {
  EmbeddedPromptInjectionChunk,
  PromptInjectionChunk,
  PromptInjectionRecord,
} from '../interfaces/prompt-injection.interface';

/** Replace-on-write channel: the last node to set the value wins. */
function replace<T>(defaultValue: () => T) {
  return Annotation<T>({
    reducer: (_current: T, update: T) => update,
    default: defaultValue,
  });
}

/**
 * State channels of the prompt-injection RAG graph.
 *
 * Each node contributes one stage of the rebuild, so the finished state is a
 * complete record of the run and doubles as the trace payload in LangSmith.
 */
export const PromptInjectionRagStateAnnotation = Annotation.Root({
  /** Version stamp of the resource file the run loaded. */
  corpusVersion: replace<string>(() => ''),
  /** Raw records read from the resource file. */
  records: replace<PromptInjectionRecord[]>(() => []),
  /** Chunks produced by the chunk node. */
  chunks: replace<PromptInjectionChunk[]>(() => []),
  /** Chunks carrying their embedding vector. */
  embeddedChunks: replace<EmbeddedPromptInjectionChunk[]>(() => []),
  /** Documents removed from the existing RAG. */
  deletedCount: replace<number>(() => 0),
  /** Documents written for the new RAG. */
  upsertedCount: replace<number>(() => 0),
  /** Accumulated across nodes so one failure does not hide another. */
  errors: Annotation<string[]>({
    reducer: (current: string[], update: string[]) => [
      ...(current ?? []),
      ...(update ?? []),
    ],
    default: () => [],
  }),
});

export type PromptInjectionRagState =
  typeof PromptInjectionRagStateAnnotation.State;
