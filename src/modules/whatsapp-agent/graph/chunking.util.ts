/**
 * Recursive character chunking used by the RAG graph's chunk node.
 *
 * Splits on the largest structural separator that fits, falling back to
 * progressively finer ones, so a chunk boundary lands between paragraphs
 * before it lands mid-word. Overlap carries the tail of a chunk into the next
 * one so a pattern straddling a boundary is still retrievable.
 */

/** Separators from coarsest to finest; the empty string is the hard fallback. */
const SEPARATORS = ['\n\n', '\n', '. ', ', ', ' ', ''];

/**
 * Split `text` into chunks of at most `chunkSize` characters with
 * `chunkOverlap` characters of trailing context repeated into the next chunk.
 */
export function splitText(
  text: string,
  chunkSize: number,
  chunkOverlap: number,
): string[] {
  const source = text?.trim() ?? '';
  if (!source) {
    return [];
  }
  const size = Math.max(1, chunkSize);
  // An overlap at or above the chunk size would never advance the cursor.
  const overlap = Math.min(Math.max(0, chunkOverlap), size - 1);
  if (source.length <= size) {
    return [source];
  }

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const window = source.slice(cursor, cursor + size);
    const end =
      cursor + size >= source.length
        ? source.length
        : cursor + breakPoint(window, size);

    const chunk = source.slice(cursor, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (end >= source.length) {
      break;
    }
    cursor = Math.max(end - overlap, cursor + 1);
  }
  return chunks;
}

/**
 * Find where to cut a full-size window: the last occurrence of the coarsest
 * separator that leaves at least half a chunk, or the window itself.
 */
function breakPoint(window: string, size: number): number {
  const minimum = Math.floor(size / 2);
  for (const separator of SEPARATORS) {
    if (!separator) {
      break;
    }
    const index = window.lastIndexOf(separator);
    if (index >= minimum) {
      return index + separator.length;
    }
  }
  return window.length;
}
