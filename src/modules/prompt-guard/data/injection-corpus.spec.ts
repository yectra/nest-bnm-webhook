import {
  CORPUS_VERSION,
  INJECTION_CORPUS,
  corpusStats,
} from './injection-corpus';

describe('injection corpus', () => {
  it('has unique ids', () => {
    const ids = INJECTION_CORPUS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries both labels, so the k-NN vote has a contrast set', () => {
    const stats = corpusStats();
    expect(stats.injections).toBeGreaterThan(30);
    expect(stats.benign).toBeGreaterThan(10);
    expect(stats.total).toBe(stats.injections + stats.benign);
    expect(stats.version).toBe(CORPUS_VERSION);
  });

  it('covers every attack family the detector reports', () => {
    const techniques = new Set(
      INJECTION_CORPUS.filter((entry) => entry.label === 'injection').map(
        (entry) => entry.technique,
      ),
    );
    expect([...techniques].sort()).toEqual([
      'data_exfiltration',
      'delimiter_spoofing',
      'encoding_obfuscation',
      'guardrail_bypass',
      'indirect_injection',
      'instruction_override',
      'payload_splitting',
      'role_play_jailbreak',
      'system_prompt_exfiltration',
      'tool_abuse',
    ]);
  });

  it('labels entries consistently with their technique and severity', () => {
    for (const entry of INJECTION_CORPUS) {
      expect(entry.text.trim().length).toBeGreaterThan(20);
      if (entry.label === 'injection') {
        expect(entry.technique).not.toBe('benign');
        expect(entry.severity).not.toBe('none');
      } else {
        expect(entry.technique).toBe('benign');
        expect(entry.severity).toBe('none');
      }
    }
  });
});
