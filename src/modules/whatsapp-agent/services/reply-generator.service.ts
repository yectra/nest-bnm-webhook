import { Injectable } from '@nestjs/common';
import { templateReply } from '../reply/templates';
import { GeneratedReply, WhatsAppMessage } from '../types';

/**
 * Produces the reply for one inbound message. In this increment replies come
 * from intent templates (the permanent no-LLM mode); the deep support agent
 * takes over in a later increment, keeping templates as its fallback.
 */
@Injectable()
export class ReplyGeneratorService {
  async generate(message: WhatsAppMessage): Promise<GeneratedReply> {
    return Promise.resolve({
      text: templateReply(message),
      source: 'template',
    });
  }
}
