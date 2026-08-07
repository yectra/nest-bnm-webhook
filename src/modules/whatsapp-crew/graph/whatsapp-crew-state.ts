import { Annotation } from '@langchain/langgraph';
import { VectorSearchResult } from '../../chatbot/interfaces/vector-search.interface';
import { WhatsappInboundMessage } from '../../whatsapp/interfaces/whatsapp-message.interface';
import {
  ResponseAttribution,
  WhatsappCrewPlan,
  WhatsappCrewTraceEntry,
  WhatsappDispatchResult,
  WhatsappMediaInsight,
} from '../interfaces/whatsapp-crew.interfaces';

/**
 * Shared LangGraph state for the WhatsApp crew:
 * intake -> supervisor -> (project | quote | requirements | feedback) ->
 * attribution -> synthesize -> piiFilter -> dispatchAgent
 *
 * The retrieval branches run in the same superstep, so their partial updates
 * target disjoint channels and the trace uses a concat reducer.
 */
export const WhatsappCrewStateAnnotation = Annotation.Root({
  message: Annotation<WhatsappInboundMessage | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  conversationId: Annotation<string>,
  userId: Annotation<string>,
  /** Text the retrieval agents and LLMs work from (body + media insights). */
  question: Annotation<string>({
    reducer: (_current, update) => update ?? '',
    default: () => '',
  }),
  history: Annotation<{ role: 'user' | 'assistant'; content: string }[]>({
    reducer: (_current, update) => update ?? [],
    default: () => [],
  }),
  mediaInsights: Annotation<WhatsappMediaInsight[]>({
    reducer: (_current, update) => update ?? [],
    default: () => [],
  }),
  plan: Annotation<WhatsappCrewPlan | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  projectMatches: Annotation<VectorSearchResult[]>({
    reducer: (_current, update) => update ?? [],
    default: () => [],
  }),
  quoteMatches: Annotation<VectorSearchResult[]>({
    reducer: (_current, update) => update ?? [],
    default: () => [],
  }),
  requirementMatches: Annotation<VectorSearchResult[]>({
    reducer: (_current, update) => update ?? [],
    default: () => [],
  }),
  feedbackMatches: Annotation<VectorSearchResult[]>({
    reducer: (_current, update) => update ?? [],
    default: () => [],
  }),
  attribution: Annotation<ResponseAttribution | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  draftReply: Annotation<string>({
    reducer: (_current, update) => update ?? '',
    default: () => '',
  }),
  finalReply: Annotation<string>({
    reducer: (_current, update) => update ?? '',
    default: () => '',
  }),
  piiRedactions: Annotation<string[]>({
    reducer: (_current, update) => update ?? [],
    default: () => [],
  }),
  dispatch: Annotation<WhatsappDispatchResult>({
    reducer: (_current, update) => update,
    default: () => ({ whatsappSent: false }),
  }),
  trace: Annotation<WhatsappCrewTraceEntry[]>({
    reducer: (current, update) => current.concat(update ?? []),
    default: () => [],
  }),
});

export type WhatsappCrewState = typeof WhatsappCrewStateAnnotation.State;

export const waTraceEntry = (
  agent: string,
  detail: string,
): WhatsappCrewTraceEntry => ({
  agent,
  detail,
  timestamp: new Date().toISOString(),
});
