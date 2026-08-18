import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  CompiledGuardGraph,
  GuardGraphFactory,
} from './graph/guard-graph.factory';
import { InjectionAssessment } from './interfaces/prompt-guard.interfaces';

/** One inbound event as accepted by POST /api/prompt-guard/events. */
export interface GuardEvent {
  id?: string;
  eventType?: string;
  subject?: string;
  eventTime?: string;
  data?: Record<string, unknown> | string;
  [key: string]: unknown;
}

/** Per-event outcome returned by the events endpoint. */
export interface GuardEventResult {
  eventId: string | null;
  eventType: string | null;
  status: 'inspected' | 'skipped';
  reason?: string;
  assessment?: InjectionAssessment;
}

/** Aggregate response for an events batch. */
export interface GuardEventBatchResult {
  processedCount: number;
  injectionDetected: boolean;
  results: GuardEventResult[];
}

/** Event Grid answers its subscription handshake with this shape. */
export interface SubscriptionValidationResponse {
  validationResponse: string;
}

const EVENT_GRID_VALIDATION_EVENT =
  'Microsoft.EventGrid.SubscriptionValidationEvent';

/** Fields checked, in order, when pulling the text out of an event payload. */
const DEFAULT_TEXT_FIELDS = [
  'text',
  'message',
  'content',
  'body',
  'prompt',
  'input',
  'question',
  'query',
  'userMessage',
  'messageBody',
  'caption',
];

const DEFAULT_MAX_INPUT_CHARS = 8000;
const DEEP_SCAN_MAX_DEPTH = 4;
/** Envelope metadata is never the message text, so the deep scan skips it. */
const ENVELOPE_KEYS = new Set([
  'id',
  'eventType',
  'subject',
  'eventTime',
  'topic',
  'dataVersion',
  'metadataVersion',
  'specversion',
  'source',
  'time',
  'type',
]);
const DEEP_SCAN_MIN_LENGTH = 8;

/**
 * Entry point of the prompt-injection guard.
 *
 * Compiles the LangGraph detector once at boot, then exposes it to the HTTP
 * endpoints and to any other module that wants to screen untrusted text before
 * it reaches an LLM.
 */
@Injectable()
export class PromptGuardService implements OnModuleInit {
  private readonly logger = new Logger(PromptGuardService.name);
  private graph!: CompiledGuardGraph;
  private readonly textFields: string[];
  private readonly maxInputChars: number;

  constructor(
    private readonly graphFactory: GuardGraphFactory,
    config: ConfigService,
  ) {
    const extraFields = (
      config.get<string>('PROMPT_GUARD_EVENT_TEXT_FIELDS') ?? ''
    )
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);
    this.textFields = [...extraFields, ...DEFAULT_TEXT_FIELDS];
    this.maxInputChars =
      Number(config.get<number | string>('PROMPT_GUARD_MAX_INPUT_CHARS')) ||
      DEFAULT_MAX_INPUT_CHARS;
  }

  onModuleInit(): void {
    this.graph = this.graphFactory.build();
    this.logger.log('Prompt-injection detector graph compiled');
  }

  /** Mermaid rendering of the compiled graph, for docs and debugging. */
  describeGraph(): string {
    return this.graph.getGraph().drawMermaid();
  }

  /**
   * Run the detector over one piece of untrusted text.
   *
   * @param text the untrusted input.
   * @param source free-form origin label recorded on the trace.
   */
  async inspect(text: string, source = 'api'): Promise<InjectionAssessment> {
    const trimmed = (text ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('text must be a non-empty string');
    }

    const truncated = trimmed.length > this.maxInputChars;
    const input = truncated ? trimmed.slice(0, this.maxInputChars) : trimmed;

    const finalState = await this.graph.invoke({ input, source });
    const assessment = finalState.assessment;
    if (!assessment) {
      // The decide node always sets this; treat its absence as a server fault
      // rather than silently reporting the input as clean.
      throw new Error('Detector graph produced no assessment');
    }

    const trace = truncated
      ? [
          ...finalState.trace,
          {
            node: 'input',
            detail: `input truncated to ${this.maxInputChars} characters before inspection`,
            timestamp: new Date().toISOString(),
          },
        ]
      : finalState.trace;

    const result: InjectionAssessment = { ...assessment, trace };
    if (result.injectionDetected) {
      this.logger.warn(
        `Prompt injection detected [source=${source}] risk=${result.riskLevel} action=${result.recommendation} techniques=${result.techniques.join('|')}`,
      );
    } else {
      this.logger.log(
        `Input cleared [source=${source}] confidence=${result.confidence}`,
      );
    }
    return result;
  }

  /**
   * Handle an inbound event (single or Event Grid batch): answer the
   * subscription handshake, otherwise inspect the text carried by each event.
   */
  async handleEvent(
    payload: unknown,
  ): Promise<GuardEventBatchResult | SubscriptionValidationResponse> {
    const events = this.normalize(payload);
    if (events.length === 0) {
      throw new BadRequestException(
        'Event payload must be an object or a non-empty array of events',
      );
    }

    const handshake = events.find(
      (event) => event.eventType === EVENT_GRID_VALIDATION_EVENT,
    );
    if (handshake) {
      const raw =
        handshake.data && typeof handshake.data === 'object'
          ? handshake.data.validationCode
          : undefined;
      const code = typeof raw === 'string' ? raw : '';
      this.logger.log(
        `[Event Grid] Subscription validation handshake received for the prompt guard. Code: ${code}`,
      );
      return { validationResponse: code };
    }

    const results: GuardEventResult[] = [];
    for (const event of events) {
      const eventId = typeof event.id === 'string' ? event.id : null;
      const eventType =
        typeof event.eventType === 'string' ? event.eventType : null;
      const text = this.extractText(event);

      if (!text) {
        this.logger.warn(
          `Event ${eventId ?? '(no id)'} carried no inspectable text; skipping`,
        );
        results.push({
          eventId,
          eventType,
          status: 'skipped',
          reason: 'no inspectable text found in the event payload',
        });
        continue;
      }

      const assessment = await this.inspect(text, eventType ?? 'event');
      results.push({ eventId, eventType, status: 'inspected', assessment });
    }

    return {
      processedCount: results.length,
      injectionDetected: results.some(
        (result) => result.assessment?.injectionDetected === true,
      ),
      results,
    };
  }

  private normalize(payload: unknown): GuardEvent[] {
    if (Array.isArray(payload)) {
      return payload.filter(
        (event): event is GuardEvent => !!event && typeof event === 'object',
      );
    }
    if (payload && typeof payload === 'object') {
      return [payload as GuardEvent];
    }
    return [];
  }

  /**
   * Pull the untrusted text out of an event: the known field names first (on
   * `data` and then on the envelope), and as a last resort the longest string
   * anywhere in the payload — producers vary, and a missed field would mean an
   * unscreened input.
   */
  private extractText(event: GuardEvent): string | null {
    if (typeof event.data === 'string' && event.data.trim()) {
      return event.data.trim();
    }

    const data: Record<string, unknown> =
      event.data && typeof event.data === 'object' ? event.data : {};

    for (const field of this.textFields) {
      const candidate =
        data[field] ?? (event as Record<string, unknown>)[field];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    const searchRoot =
      Object.keys(data).length > 0
        ? data
        : Object.fromEntries(
            Object.entries(event as Record<string, unknown>).filter(
              ([key]) => !ENVELOPE_KEYS.has(key),
            ),
          );
    const deepest = this.longestString(searchRoot, 0);
    return deepest && deepest.length >= DEEP_SCAN_MIN_LENGTH ? deepest : null;
  }

  private longestString(value: unknown, depth: number): string | null {
    if (depth > DEEP_SCAN_MAX_DEPTH) {
      return null;
    }
    if (typeof value === 'string') {
      return value.trim() || null;
    }
    if (Array.isArray(value)) {
      return value
        .map((item) => this.longestString(item, depth + 1))
        .reduce<string | null>(
          (longest, current) =>
            current && (!longest || current.length > longest.length)
              ? current
              : longest,
          null,
        );
    }
    if (value && typeof value === 'object') {
      return this.longestString(Object.values(value), depth);
    }
    return null;
  }
}
