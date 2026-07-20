import { Injectable } from '@nestjs/common';

/**
 * Service responsible for post‑processing the LLM answer before it is returned to the client.
 * Future enhancements may include citation insertion, anti‑hallucination trimming,
 * and markdown sanitisation. Currently it trims whitespace and ensures a clean string.
 */
@Injectable()
export class ResponseFormatterService {
  /**
   * Apply formatting rules to the raw LLM answer.
   * @param answer Raw answer string from the LLM.
   * @returns Formatted answer.
   */
  format(answer: string): string {
    // Trim leading/trailing whitespace and collapse multiple trailing newlines.
    return answer?.trim() ?? '';
  }
}
