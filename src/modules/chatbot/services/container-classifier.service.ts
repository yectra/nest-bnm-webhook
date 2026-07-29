import { Injectable, Logger } from '@nestjs/common';
import { ContainerClassificationResult } from '../interfaces/vector-search.interface';

const DOMAIN_RULES: { domain: string; container: string; patterns: RegExp[] }[] = [
  {
    domain: 'SERVICE',
    container: 'Service',
    patterns: [/service/i, /painting/i, /kitchen/i, /interior/i, /ceiling/i, /tree/i, /repair/i, /cleaning/i, /plumb/i, /electric/i],
  },
  {
    domain: 'PROJECTS',
    container: 'Project',
    patterns: [/project/i, /renovation/i, /status/i, /progress/i, /site/i],
  },
  {
    domain: 'QUOTES',
    container: 'Quote',
    patterns: [/quote/i, /quotation/i, /price/i, /pricing/i, /cost/i, /estimate/i, /budget/i],
  },
  {
    domain: 'VENDORS',
    container: 'Vendor',
    patterns: [/vendor/i, /supplier/i, /contractor/i, /dealer/i],
  },
  {
    domain: 'CATEGORIES',
    container: 'Category',
    patterns: [/category/i, /categories/i, /catalog/i],
  },
  {
    domain: 'CONTACT',
    container: 'ContactUs',
    patterns: [/contact/i, /help/i, /support/i, /inquiry/i, /reach/i],
  },
];

@Injectable()
export class ContainerClassifierService {
  private readonly logger = new Logger(ContainerClassifierService.name);

  /**
   * Instant non-blocking intent classification (0ms overhead).
   */
  classify(message: string): ContainerClassificationResult {
    const text = message.trim();

    for (const rule of DOMAIN_RULES) {
      if (rule.patterns.some((pattern) => pattern.test(text))) {
        this.logger.log(`Instant Classification: domain="${rule.domain}", container="${rule.container}"`);
        return {
          domain: rule.domain,
          container: rule.container,
          confidence: 0.9,
        };
      }
    }

    return {
      domain: 'GENERAL',
      container: 'Service',
      confidence: 0.5,
    };
  }
}
