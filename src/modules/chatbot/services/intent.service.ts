import { Injectable } from '@nestjs/common';
import { KNOWLEDGE_MAP } from '../../../common/constants/knowledge-map';

@Injectable()
export class IntentService {
  detect(message: string) {
    const text = message.toLowerCase();

    for (const item of KNOWLEDGE_MAP) {
      if (item.keywords.some((keyword) => text.includes(keyword))) {
        return item;
      }
    }

    return {
      domain: 'GENERAL',
      container: null,
    };
  }
}
