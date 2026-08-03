import { ConfigService } from '@nestjs/config';
import { PiiFilterService } from './pii-filter.service';
import { CrewLlmProvider } from './crew-llm.provider';

describe('PiiFilterService', () => {
  let service: PiiFilterService;
  let llm: { complete: jest.Mock };

  const buildService = (llmReview: unknown = false) => {
    llm = { complete: jest.fn() };
    const config = {
      get: jest.fn((key: string) =>
        key === 'AGENT_CREW_PII_LLM_REVIEW' ? llmReview : undefined,
      ),
    } as unknown as ConfigService;
    return new PiiFilterService(llm as unknown as CrewLlmProvider, config);
  };

  beforeEach(() => {
    service = buildService(false);
  });

  it('redacts email addresses', () => {
    const result = service.redact('Reach me at john.doe@example.com please');
    expect(result.text).toBe('Reach me at [REDACTED EMAIL] please');
    expect(result.redactions).toContain('email (1)');
  });

  it('redacts phone numbers', () => {
    const result = service.redact('Call +91 98765 43210 for details');
    expect(result.text).not.toContain('98765');
    expect(result.text).toContain('[REDACTED');
  });

  it('redacts Aadhaar-style national IDs', () => {
    const result = service.redact('My aadhaar is 1234 5678 9012 ok');
    expect(result.text).not.toContain('1234 5678 9012');
    expect(result.text).toContain('[REDACTED ID]');
  });

  it('redacts payment card numbers', () => {
    const result = service.redact('Card 4111 1111 1111 1111 was charged');
    expect(result.text).not.toContain('4111');
    expect(result.text).toContain('[REDACTED CARD]');
  });

  it('redacts PAN-style tax IDs', () => {
    const result = service.redact('PAN ABCDE1234F on file');
    expect(result.text).toBe('PAN [REDACTED ID] on file');
  });

  it('leaves clean text untouched', () => {
    const clean = 'Modular kitchen installation costs vary by size.';
    const result = service.redact(clean);
    expect(result.text).toBe(clean);
    expect(result.redactions).toEqual([]);
  });

  it('skips the LLM review pass when disabled', async () => {
    const result = await service.filter('Contact a@b.com now');
    expect(result.text).toBe('Contact [REDACTED EMAIL] now');
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('uses the LLM review pass when enabled', async () => {
    service = buildService(true);
    llm.complete.mockResolvedValue('Contact [REDACTED NAME] now');
    const result = await service.filter('Contact John Smith now');
    expect(llm.complete).toHaveBeenCalled();
    expect(result.text).toBe('Contact [REDACTED NAME] now');
    expect(result.redactions).toContain('llm review pass');
  });

  it('falls back to regex output when the LLM review fails', async () => {
    service = buildService(true);
    llm.complete.mockRejectedValue(new Error('timeout'));
    const result = await service.filter('Contact a@b.com now');
    expect(result.text).toBe('Contact [REDACTED EMAIL] now');
  });
});
