import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface DiscoveredService {
  id: string;
  name: string;
  address: string;
  port: number;
  status: 'passing' | 'not-passing';
}

interface ConsulServiceEntry {
  Service?: {
    ID?: string;
    Service?: string;
    Address?: string;
    Port?: number;
  };
  Node?: {
    Address?: string;
  };
  Checks?: Array<{
    Status?: string;
  }>;
}

@Injectable()
export class ConsulDiscoveryService {
  private readonly logger = new Logger(ConsulDiscoveryService.name);

  constructor(@Optional() private readonly configService?: ConfigService) {}

  private getEnv(key: string, defaultValue?: string): string | undefined {
    return (
      this.configService?.get<string>(key) ?? process.env[key] ?? defaultValue
    );
  }

  get consulUrl(): string {
    return (
      this.getEnv('CONSUL_HTTP_ADDR', 'http://127.0.0.1:8500') ??
      'http://127.0.0.1:8500'
    ).replace(/\/+$/, '');
  }

  private getConsulToken(): string | undefined {
    return this.getEnv('CONSUL_HTTP_TOKEN');
  }

  async discoverService(serviceName: string): Promise<DiscoveredService[]> {
    if (!serviceName || !serviceName.trim()) {
      throw new Error('Service name is required for discovery');
    }

    const trimmedName = serviceName.trim();
    const url = `${this.consulUrl}/v1/health/service/${encodeURIComponent(trimmedName)}?passing`;

    const headers: Record<string, string> = {};
    const token = this.getConsulToken();

    if (token) {
      headers['X-Consul-Token'] = token;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(3000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Consul discovery request failed for ${trimmedName}: ${message}`,
      );
      throw new Error(`Consul discovery network error: ${message}`);
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      this.logger.warn(
        `Consul discovery failed for ${trimmedName}: HTTP ${response.status}`,
      );
      throw new Error(
        `Consul discovery failed: HTTP ${response.status}${errorBody ? `: ${errorBody}` : ''}`,
      );
    }

    let rawData: unknown;
    try {
      rawData = await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to parse Consul discovery JSON for ${trimmedName}: ${message}`,
      );
      throw new Error(`Invalid JSON response from Consul: ${message}`);
    }

    if (!Array.isArray(rawData)) {
      this.logger.warn(
        `Expected array from Consul for ${trimmedName}, got ${typeof rawData}`,
      );
      return [];
    }

    const entries = rawData as ConsulServiceEntry[];

    return entries
      .map((entry) => {
        const address = (
          entry.Service?.Address ||
          entry.Node?.Address ||
          ''
        ).trim();
        const port = Number(entry.Service?.Port ?? 0);
        const checks = Array.isArray(entry.Checks) ? entry.Checks : [];
        const isPassing =
          checks.length > 0 &&
          checks.every((check) => check.Status === 'passing');

        return {
          id: entry.Service?.ID ?? '',
          name: entry.Service?.Service ?? trimmedName,
          address,
          port,
          status: isPassing ? ('passing' as const) : ('not-passing' as const),
        };
      })
      .filter(
        (svc) => svc.address.length > 0 && svc.port > 0 && svc.port <= 65535,
      );
  }
}
