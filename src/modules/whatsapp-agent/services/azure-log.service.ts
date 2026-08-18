import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Structured application logging for Azure.
 *
 * Every record is emitted on stdout as one single-line JSON document prefixed
 * with `[AZURE-LOG][<category>]`, which is what Azure App Service ships to the
 * log stream and to Log Analytics (`AppServiceConsoleLogs`) / Application
 * Insights trace telemetry. Keeping each record on one line is what makes it
 * queryable there — multi-line blocks arrive as unrelated rows.
 */
@Injectable()
export class AzureLogService {
  private readonly logger = new Logger('AzureLog');

  constructor(private readonly configService: ConfigService) {}

  log(category: string, record: Record<string, unknown>): void {
    this.logger.log(this.format(category, record));
  }

  warn(category: string, record: Record<string, unknown>): void {
    this.logger.warn(this.format(category, record));
  }

  error(category: string, record: Record<string, unknown>): void {
    this.logger.error(this.format(category, record));
  }

  private format(category: string, record: Record<string, unknown>): string {
    const envelope = {
      category,
      appName: 'BNM Webhook Backend (NestJS)',
      appEnv:
        this.configService.get<string>('app.appEnv') ||
        process.env.APP_ENV ||
        'main',
      nodeEnv:
        this.configService.get<string>('app.nodeEnv') ||
        process.env.NODE_ENV ||
        'development',
      processId: process.pid,
      timestamp: new Date().toISOString(),
      ...record,
    };

    try {
      return `[AZURE-LOG][${category}] ${JSON.stringify(envelope)}`;
    } catch {
      // A non-serializable value must never take down the request path: drop
      // the caller's record and keep the envelope, which is always safe.
      const { appName, appEnv, nodeEnv, processId, timestamp } = envelope;
      return `[AZURE-LOG][${category}] ${JSON.stringify({
        category,
        appName,
        appEnv,
        nodeEnv,
        processId,
        timestamp,
        serializationError: true,
      })}`;
    }
  }
}
