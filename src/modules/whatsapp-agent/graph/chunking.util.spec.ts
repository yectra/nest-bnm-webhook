import { splitText } from './chunking.util';

describe('splitText', () => {
  it('returns a single chunk when the text fits', () => {
    expect(splitText('short text', 100, 20)).toEqual(['short text']);
  });

  it('returns nothing for empty input', () => {
    expect(splitText('   ', 100, 20)).toEqual([]);
  });

  it('respects the chunk size', () => {
    const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const chunks = splitText(text, 80, 10);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(80);
    }
  });

  it('preserves the whole text across chunks', () => {
    const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const joined = splitText(text, 60, 0).join(' ');

    expect(joined.replace(/\s+/g, ' ')).toBe(text);
  });

  it('overlaps consecutive chunks', () => {
    const text = 'a'.repeat(200);
    const chunks = splitText(text, 100, 30);

    expect(chunks.length).toBeGreaterThan(1);
    // With overlap the chunks together cover more than the original length.
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    expect(total).toBeGreaterThan(text.length);
  });

  it('terminates when the overlap is larger than the chunk size', () => {
    const chunks = splitText('x'.repeat(500), 50, 500);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk) => chunk.length <= 50)).toBe(true);
  });

  it('prefers paragraph boundaries over mid-word cuts', () => {
    const paragraph = 'A'.repeat(40);
    const chunks = splitText(`${paragraph}\n\n${paragraph}`, 60, 0);

    expect(chunks[0]).toBe(paragraph);
  });
});
