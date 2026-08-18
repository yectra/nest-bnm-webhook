import {
  InjectionSeverity,
  SignatureLabel,
  SignatureMatch,
} from '../interfaces/prompt-guard.interfaces';
import { InjectionScoringService } from './injection-scoring.service';

const match = (
  label: SignatureLabel,
  similarity: number,
  severity: InjectionSeverity = 'high',
): SignatureMatch => ({
  id: `${label}-${similarity}`,
  label,
  technique: label === 'injection' ? 'instruction_override' : 'benign',
  severity,
  distance: 1 - similarity,
  similarity,
  excerpt: 'example',
});

describe('InjectionScoringService', () => {
  const service = new InjectionScoringService();

  describe('vote', () => {
    it('returns a zero score when nothing clears the similarity floor', () => {
      const verdict = service.vote([
        match('injection', 0.2),
        match('benign', 0.1),
      ]);
      expect(verdict.score).toBe(0);
      expect(verdict.topTechnique).toBeNull();
    });

    it('votes for injection when the close neighbours are injections', () => {
      const verdict = service.vote([
        match('injection', 0.78),
        match('injection', 0.7),
        match('benign', 0.5),
      ]);
      expect(verdict.score).toBeGreaterThan(0.8);
      expect(verdict.topTechnique).toBe('instruction_override');
      expect(verdict.nearestInjectionSimilarity).toBe(0.78);
      expect(verdict.nearestBenignSimilarity).toBe(0.5);
    });

    it('votes against injection when the close neighbours are benign', () => {
      const verdict = service.vote([
        match('benign', 0.82),
        match('benign', 0.74),
        match('injection', 0.5),
      ]);
      expect(verdict.score).toBeLessThan(0.2);
    });

    it('lets a near-duplicate of a known attack decide on its own', () => {
      const verdict = service.vote([
        match('injection', 0.93),
        match('benign', 0.9),
        match('benign', 0.88),
      ]);
      expect(verdict.score).toBeGreaterThanOrEqual(0.95);
    });

    it('damps the vote when the nearest injection barely cleared the floor', () => {
      const weak = service.vote([
        match('injection', 0.5),
        match('injection', 0.48),
      ]);
      const strong = service.vote([
        match('injection', 0.84),
        match('injection', 0.8),
      ]);
      expect(weak.score).toBeCloseTo(strong.score, 5);
      expect(weak.support).toBeLessThan(strong.support);
      expect(weak.effectiveScore).toBeLessThan(strong.effectiveScore);
      expect(weak.effectiveScore).toBeGreaterThanOrEqual(weak.score * 0.5);
    });

    it('weights a critical signature above a low-severity one', () => {
      const critical = service.vote([
        match('injection', 0.7, 'critical'),
        match('benign', 0.7),
      ]);
      const low = service.vote([
        match('injection', 0.7, 'low'),
        match('benign', 0.7),
      ]);
      expect(critical.score).toBeGreaterThan(low.score);
    });
  });

  describe('fuse', () => {
    it('pools retrieval and the pattern scan as independent evidence', () => {
      expect(service.fuse(1, 0, null)).toBeCloseTo(0.95, 5);
      expect(service.fuse(0, 1, null)).toBeCloseTo(0.9, 5);
      expect(service.fuse(0.5, 0.5, null)).toBeCloseTo(0.71125, 5);
    });

    // The pattern rules only cover about half of the corpus, so a silent scan
    // must never veto a confident retrieval match.
    it('lets retrieval alone clear the decision threshold', () => {
      expect(service.fuse(0.9, 0, null)).toBeGreaterThan(
        service.config.decisionThreshold,
      );
    });

    it('averages the judge in as a two-way adjudicator', () => {
      expect(service.fuse(0, 0, 1)).toBeCloseTo(0.45, 5);
      expect(service.fuse(1, 1, 1)).toBeGreaterThan(0.99);
    });

    it('lets a confident judge veto the cheap signals', () => {
      expect(service.fuse(0.95, 0, 0.05)).toBeLessThan(
        service.config.decisionThreshold,
      );
    });

    it('clamps out-of-range and non-finite inputs', () => {
      expect(service.fuse(5, 5, 5)).toBeGreaterThan(0.99);
      expect(service.fuse(Number.NaN, 0, null)).toBe(0);
    });
  });

  describe('judgeScore', () => {
    it('is null without a verdict', () => {
      expect(service.judgeScore(null)).toBeNull();
    });

    it('inverts the confidence when the judge says the input is clean', () => {
      expect(
        service.judgeScore({
          injection: false,
          confidence: 0.9,
          technique: 'benign',
          reason: 'ordinary request',
        }),
      ).toBeCloseTo(0.1, 5);
    });
  });

  describe('needsJudge', () => {
    it('escalates when retrieval is unavailable', () => {
      expect(service.needsJudge(0, 0, true)).toBe(true);
    });

    it('escalates inside the uncertainty band', () => {
      expect(service.needsJudge(0.6, 0, false)).toBe(true);
    });

    it('skips the judge when both cheap signals agree the input is clean', () => {
      expect(service.needsJudge(0.02, 0, false)).toBe(false);
    });

    it('skips the judge when both cheap signals agree it is an attack', () => {
      expect(service.needsJudge(0.98, 0.95, false)).toBe(false);
    });

    it('escalates when the signals contradict each other', () => {
      expect(service.needsJudge(0.95, 0, false)).toBe(true);
      expect(service.needsJudge(0, 0.95, false)).toBe(true);
    });
  });

  describe('verdict presentation', () => {
    it('blocks a confident detection and asks for review on a borderline one', () => {
      expect(service.recommendation(true, 0.95)).toBe('block');
      expect(service.recommendation(true, 0.62)).toBe('review');
      expect(service.recommendation(false, 0.5)).toBe('review');
      expect(service.recommendation(false, 0.05)).toBe('allow');
    });

    it('reports no risk when nothing was detected', () => {
      const verdict = service.vote([match('injection', 0.9)]);
      expect(service.riskLevel(false, [], verdict)).toBe('none');
    });

    it('takes the worst severity across heuristics and matches', () => {
      const verdict = service.vote([match('injection', 0.9, 'critical')]);
      const risk = service.riskLevel(
        true,
        [
          {
            rule: 'ignore-previous-instructions',
            technique: 'instruction_override',
            severity: 'medium',
            evidence: 'ignore all previous instructions',
          },
        ],
        verdict,
      );
      expect(risk).toBe('critical');
    });

    it('lists implicated techniques worst-first without duplicates', () => {
      const verdict = service.vote([
        match('injection', 0.9, 'medium'),
        match('benign', 0.8),
      ]);
      const techniques = service.techniques(
        [
          {
            rule: 'destructive-tool-call',
            technique: 'tool_abuse',
            severity: 'critical',
            evidence: 'drop table customers',
          },
        ],
        verdict,
      );
      expect(techniques[0]).toBe('tool_abuse');
      expect(techniques).toContain('instruction_override');
      expect(techniques).not.toContain('benign');
      expect(new Set(techniques).size).toBe(techniques.length);
    });
  });
});
