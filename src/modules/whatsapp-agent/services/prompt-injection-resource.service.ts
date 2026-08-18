import { Injectable, Logger } from '@nestjs/common';

import corpusResource from '../resources/prompt-injections.json';
import type {
  PromptInjectionCorpus,
  PromptInjectionRecord,
} from '../interfaces/prompt-injection.interface';

/**
 * Loads the known-prompt-injection corpus from the bundled resource file.
 *
 * The corpus is versioned defensive content, so it ships with the code rather
 * than being fetched at runtime: a rebuild is reproducible and works with no
 * network access. Records are normalised and validated here so the graph's
 * chunk node can assume well-formed input.
 */
@Injectable()
export class PromptInjectionResourceService {
  private readonly logger = new Logger(PromptInjectionResourceService.name);

  /** The corpus as authored, with malformed records dropped. */
  load(): PromptInjectionCorpus {
    const corpus: PromptInjectionCorpus =
      corpusResource as PromptInjectionCorpus;
    const injections = (corpus.injections ?? []).filter((record) =>
      this.isUsable(record),
    );

    if (injections.length !== (corpus.injections ?? []).length) {
      this.logger.warn(
        `Dropped ${(corpus.injections ?? []).length - injections.length} malformed prompt-injection record(s)`,
      );
    }

    return { ...corpus, injections };
  }

  /**
   * Render one record as the retrievable text of its RAG entry.
   *
   * Every field the guard reasons over is included, in a stable order, so a
   * retrieved chunk carries the attack family, how it looks, and what to do
   * about it — not just a bare pattern string.
   */
  toDocument(record: PromptInjectionRecord): string {
    const patterns = record.patterns
      .map((pattern) => `- ${pattern}`)
      .join('\n');

    return [
      `Prompt injection technique: ${record.title}`,
      `Category: ${record.category}`,
      `Severity: ${record.severity}`,
      `Summary: ${record.summary}`,
      `Representative phrasings:\n${patterns}`,
      `Example attack: ${record.example}`,
      `Detection guidance: ${record.detectionGuidance}`,
      `Recommended action: ${record.recommendedAction}`,
    ].join('\n\n');
  }

  private isUsable(record: PromptInjectionRecord): boolean {
    return Boolean(
      record?.id &&
      record?.title &&
      Array.isArray(record?.patterns) &&
      record.patterns.length > 0,
    );
  }
}
