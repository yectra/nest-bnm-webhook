import { Annotation } from '@langchain/langgraph';
import { VectorSearchResult } from '../../chatbot/interfaces/vector-search.interface';
import {
  CrewDispatchResult,
  CrewImageInsight,
  CrewPlan,
  CrewTraceEntry,
} from '../interfaces/crew.interfaces';

/**
 * Shared LangGraph state flowing through the crew:
 * supervisor -> (services | quotes | images) -> synthesize -> piiFilter -> dispatch
 *
 * The retrieval branches run in the same superstep, so their partial updates
 * target disjoint keys and the trace uses a concat reducer.
 */
export const CrewStateAnnotation = Annotation.Root({
  question: Annotation<string>,
  conversationId: Annotation<string>,
  userId: Annotation<string>,
  channel: Annotation<'Website' | 'Teams'>,
  history: Annotation<{ role: 'user' | 'assistant'; content: string }[]>({
    reducer: (_current, update) => update ?? [],
    default: () => [],
  }),
  plan: Annotation<CrewPlan | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  serviceMatches: Annotation<VectorSearchResult[]>({
    reducer: (_current, update) => update ?? [],
    default: () => [],
  }),
  quoteMatches: Annotation<VectorSearchResult[]>({
    reducer: (_current, update) => update ?? [],
    default: () => [],
  }),
  imageInsights: Annotation<CrewImageInsight[]>({
    reducer: (_current, update) => update ?? [],
    default: () => [],
  }),
  draftAnswer: Annotation<string>({
    reducer: (_current, update) => update ?? '',
    default: () => '',
  }),
  finalAnswer: Annotation<string>({
    reducer: (_current, update) => update ?? '',
    default: () => '',
  }),
  piiRedactions: Annotation<string[]>({
    reducer: (_current, update) => update ?? [],
    default: () => [],
  }),
  dispatch: Annotation<CrewDispatchResult>({
    reducer: (_current, update) => update,
    default: () => ({ teamsSent: false, websocketEmitted: false }),
  }),
  trace: Annotation<CrewTraceEntry[]>({
    reducer: (current, update) => current.concat(update ?? []),
    default: () => [],
  }),
});

export type CrewState = typeof CrewStateAnnotation.State;
export type CrewStateUpdate = typeof CrewStateAnnotation.Update;

export const traceEntry = (agent: string, detail: string): CrewTraceEntry => ({
  agent,
  detail,
  timestamp: new Date().toISOString(),
});
