import { DedupService } from '../services/dedup.service';
import { ReplyGeneratorService } from '../services/reply-generator.service';
import {
  SendResult,
  WhatsappReplyService,
} from '../services/whatsapp-reply.service';
import { GeneratedReply, WhatsAppMessage } from '../types';

export function makeMessage(
  overrides: Partial<WhatsAppMessage> = {},
): WhatsAppMessage {
  return {
    messageSid: 'SM123',
    from: 'whatsapp:+919876543210',
    to: 'whatsapp:+14155238886',
    body: 'hello',
    profileName: 'Kannan',
    messageType: 'TEXT',
    direction: 'INBOUND',
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

export class MemoryDedupStub {
  processed = new Map<string, Record<string, unknown> | undefined>();
  failOnCheck = false;

  isProcessed(messageSid: string): Promise<boolean> {
    if (this.failOnCheck) {
      // The real DedupService fails open internally; this stub simulates the
      // post-fail-open result ("not a duplicate") for handler-level tests.
      return Promise.resolve(false);
    }
    return Promise.resolve(this.processed.has(messageSid));
  }

  markProcessed(
    messageSid: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    this.processed.set(messageSid, meta);
    return Promise.resolve();
  }

  asService(): DedupService {
    return this as unknown as DedupService;
  }
}

export class SenderStub {
  calls: Array<{ to: string; body: string }> = [];

  constructor(private readonly behavior: 'ok' | 'fail' | 'skip' = 'ok') {}

  send(to: string, body: string): Promise<SendResult> {
    this.calls.push({ to, body });
    if (this.behavior === 'fail') {
      return Promise.reject(new Error('twilio outage'));
    }
    if (this.behavior === 'skip') {
      return Promise.resolve({ skipped: true });
    }
    return Promise.resolve({ sid: 'SMreply1', skipped: false });
  }

  asService(): WhatsappReplyService {
    return this as unknown as WhatsappReplyService;
  }
}

export class GeneratorStub {
  constructor(
    private readonly impl: (
      message: WhatsAppMessage,
    ) => Promise<GeneratedReply>,
  ) {}

  generate(message: WhatsAppMessage): Promise<GeneratedReply> {
    return this.impl(message);
  }

  asService(): ReplyGeneratorService {
    return this;
  }
}
