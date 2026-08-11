import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CosmosService } from '../../database/cosmos.service';

/**
 * One audit row per generated reply — written ALWAYS, whether the reply was
 * sent, disabled by the kill switch, skipped, or failed to send. Captures
 * the WHATSAPP_AGENT_REPLY_ENABLED value in effect (sendEnabled) so audits
 * from dry runs are distinguishable from live traffic.
 */
export interface AuditEntry {
  messageSid: string;
  /** Sender's phone number (normalized, no whatsapp: prefix). */
  phone: string;
  /** Final reply text after PII redaction — exactly what was/would be sent. */
  reply: string;
  /** Where the reply came from: agent | template | refusal. */
  source: string;
  /** Value of the reply kill switch when this reply was produced. */
  sendEnabled: boolean;
  /** Outcome: replied | send-disabled | send-skipped | send-failed. */
  status: string;
  /** Twilio message SID when the send succeeded. */
  replySid?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly cosmosService: CosmosService,
    private readonly configService: ConfigService,
  ) {}

  /** Write an audit row. An audit outage never blocks the message. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      const container = this.cosmosService.getContainer(
        this.configService.get<string>('whatsappAgent.containers.audit') ||
          'WhatsAppAgentAudit',
      );
      await container.items.create({
        id: randomUUID(), // retries can audit the same messageSid again
        ...entry,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn(
        `audit write failed for ${entry.messageSid}: ${String(error)}`,
      );
    }
  }
}
