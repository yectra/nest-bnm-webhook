import { ConfigService } from '@nestjs/config';
import { AuditEntry, AuditService } from '../services/audit.service';
import { DedupService } from '../services/dedup.service';
import { ReplyGeneratorService } from '../services/reply-generator.service';
import {
  SendResult,
  WhatsappReplyService,
} from '../services/whatsapp-reply.service';
import { WhatsappEventHandlerService } from '../services/whatsapp-event-handler.service';
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
    return this as unknown as ReplyGeneratorService;
  }
}

export class AuditStub {
  entries: AuditEntry[] = [];
  failOnRecord = false;

  record(entry: AuditEntry): Promise<void> {
    if (this.failOnRecord) {
      // The real AuditService fails open internally; this stub simulates
      // the post-fail-open result (nothing recorded) for handler tests.
      return Promise.resolve();
    }
    this.entries.push(entry);
    return Promise.resolve();
  }

  asService(): AuditService {
    return this as unknown as AuditService;
  }
}

export interface HandlerSetup {
  handler: WhatsappEventHandlerService;
  dedup: MemoryDedupStub;
  sender: SenderStub;
  generator: GeneratorStub;
  audit: AuditStub;
}

/** Build a handler wired to stubs; override any piece per test. */
export function makeHandlerSetup(
  overrides: {
    dedup?: MemoryDedupStub;
    sender?: SenderStub;
    generator?: GeneratorStub;
    audit?: AuditStub;
    replyEnabled?: boolean;
  } = {},
): HandlerSetup {
  const dedup = overrides.dedup ?? new MemoryDedupStub();
  const sender = overrides.sender ?? new SenderStub('ok');
  const generator =
    overrides.generator ??
    new GeneratorStub(() =>
      Promise.resolve({ text: 'generated reply', source: 'template' }),
    );
  const audit = overrides.audit ?? new AuditStub();
  const configService = {
    get: (key: string) =>
      key === 'whatsappAgent.replyEnabled'
        ? (overrides.replyEnabled ?? true)
        : undefined,
  } as unknown as ConfigService;
  const handler = new WhatsappEventHandlerService(
    dedup.asService(),
    generator.asService(),
    sender.asService(),
    audit.asService(),
    configService,
  );
  return { handler, dedup, sender, generator, audit };
}
