import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PromptInjectionDetectorService } from '../../whatsapp-agent/services/prompt-injection-detector.service';

export interface EventGridEvent<T = any> {
  id?: string;
  eventType?: string;
  subject?: string;
  eventTime?: string;
  data?: T;
  topic?: string;
  dataVersion?: string;
  metadataVersion?: string;
}

export interface SubscriptionValidationData {
  validationCode: string;
  validationUrl?: string;
}

@Injectable()
export class EventGridService {
  private readonly logger = new Logger(EventGridService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly promptInjectionDetector: PromptInjectionDetectorService,
  ) {}

  processEvent(payload: EventGridEvent | EventGridEvent[]) {
    const events = Array.isArray(payload) ? payload : [payload];
    const results: any[] = [];

    for (const event of events) {
      // Handle Azure Event Grid Subscription Validation Handshake
      if (
        event?.eventType === 'Microsoft.EventGrid.SubscriptionValidationEvent'
      ) {
        const validationData = event.data as SubscriptionValidationData;
        const validationCode = validationData?.validationCode;

        this.logger.log(
          `[Azure Event Grid] Subscription validation handshake received. Code: ${validationCode}`,
        );

        results.push({ validationResponse: validationCode });
        continue;
      }

      // Log event details if matching target event or standard Event Grid event
      if (event?.eventType === 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT') {
        this.logCapturedEvent(event);
        // "Post Your Requirements" text is customer-authored and is later read
        // by the agents, so it is scanned for prompt injection and reported.
        const injection = this.inspectForPromptInjection(event);
        results.push({
          status: 'success',
          eventId: event.id,
          eventType: event.eventType,
          promptInjection: injection,
        });
      } else {
        this.logger.warn(
          `[Azure Event Grid] Received unknown or unhandled event type: ${event?.eventType}`,
        );
        this.logCapturedEvent(event);
        results.push({
          status: 'ignored',
          eventId: event?.id,
          eventType: event?.eventType,
        });
      }
    }

    // Return validation response for subscription handshake if present
    const validationResult = results.find((r) => r.validationResponse);
    if (validationResult) {
      return validationResult;
    }

    return {
      message: 'Event Grid payload processed successfully',
      processedCount: events.length,
      results,
    };
  }

  /**
   * Runs the adversarial-input guard over the requirement text. The guard is
   * report-only and fails open: a guard error must never fail the delivery of
   * an otherwise valid event.
   */
  private inspectForPromptInjection(event: EventGridEvent): {
    detected: boolean;
    risk: string;
    scannedFields: number;
    signals?: string[];
  } {
    try {
      const report = this.promptInjectionDetector.inspectEvent(event);
      const signals = report.fieldScans
        .flatMap((entry) => entry.scan.signals)
        .map((signal) => signal.ruleId);

      return {
        detected: report.detected,
        risk: report.risk,
        scannedFields: report.scannedFields,
        ...(signals.length > 0 ? { signals: [...new Set(signals)] } : {}),
      };
    } catch (error) {
      this.logger.warn(
        `[prompt-injection] guard failed for event ${event?.id ?? 'N/A'}: ${String(error)}`,
      );
      return { detected: false, risk: 'unknown', scannedFields: 0 };
    }
  }

  private logCapturedEvent(event: EventGridEvent) {
    const appEnv =
      this.configService.get<string>('app.appEnv') ||
      process.env.APP_ENV ||
      'main';
    const nodeEnv =
      this.configService.get<string>('NODE_ENV') ||
      process.env.NODE_ENV ||
      'development';

    const nestAppDetails = {
      appName: 'BNM Webhook Backend (NestJS)',
      environment: {
        appEnv,
        nodeEnv,
      },
      processId: process.pid,
      serverTimestamp: new Date().toISOString(),
      handler: 'EventGridService.processEvent',
    };

    const eventDetails = {
      eventName: event.eventType || 'N/A',
      eventId: event.id || 'N/A',
      eventTimestamp: event.eventTime || 'N/A',
      subject: event.subject || event.topic || 'N/A',
      payload: event.data ?? {},
    };

    this.logger.log(
      `==================== AZURE EVENT GRID EVENT CAPTURED ====================\n` +
        `--- NestJS Application Details ---\n` +
        JSON.stringify(nestAppDetails, null, 2) +
        `\n--- Captured Event Details ---\n` +
        JSON.stringify(eventDetails, null, 2) +
        `\n========================================================================`,
    );
  }
}
