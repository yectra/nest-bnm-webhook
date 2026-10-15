import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ConsulRegistrationService implements OnApplicationShutdown {
  private readonly logger = new Logger(ConsulRegistrationService.name);

  private registered = false;

  constructor(@Optional() private readonly configService?: ConfigService) {}

  private getEnv(key: string, defaultValue?: string): string | undefined {
    return (
      this.configService?.get<string>(key) ?? process.env[key] ?? defaultValue
    );
  }

  private getBooleanEnv(key: string, defaultValue = false): boolean {
    const val =
      this.configService?.get<string | boolean>(key) ?? process.env[key];
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') return val.toLowerCase() === 'true';
    return defaultValue;
  }

  private getNumberEnv(key: string, defaultValue = 3000): number {
    const val =
      this.configService?.get<string | number>(key) ?? process.env[key];
    const parsed = Number(val);
    return !Number.isNaN(parsed) && parsed > 0 ? parsed : defaultValue;
  }

  get consulUrl(): string {
    return (
      this.getEnv('CONSUL_HTTP_ADDR', 'http://127.0.0.1:8500') ??
      'http://127.0.0.1:8500'
    ).replace(/\/+$/, '');
  }

  get serviceId(): string {
    return (
      this.getEnv('CONSUL_SERVICE_ID', 'bricknmortar-nestjs-api-1') ??
      'bricknmortar-nestjs-api-1'
    );
  }

  get serviceName(): string {
    return (
      this.getEnv('CONSUL_SERVICE_NAME', 'bricknmortar-nestjs-api') ??
      'bricknmortar-nestjs-api'
    );
  }

  get port(): number {
    return this.getNumberEnv('PORT', 3000);
  }

  get serviceAddress(): string {
    return this.getEnv('CONSUL_SERVICE_ADDRESS', '127.0.0.1') ?? '127.0.0.1';
  }

  get isEnabled(): boolean {
    return this.getBooleanEnv('CONSUL_ENABLED', false);
  }

  get isRequired(): boolean {
    return this.getBooleanEnv('CONSUL_REQUIRED', false);
  }

  get deregisterCriticalServiceAfter(): string {
    return this.getEnv('CONSUL_DEREGISTER_CRITICAL_AFTER', '1m') ?? '1m';
  }

  private getConsulToken(): string | undefined {
    return this.getEnv('CONSUL_HTTP_TOKEN');
  }

  isRegistered(): boolean {
    return this.registered;
  }

  async register(): Promise<void> {
    if (!this.isEnabled) {
      this.logger.log(
        'Consul registration is disabled (CONSUL_ENABLED != true)',
      );
      return;
    }

    if (this.registered) {
      this.logger.log(
        `Service ${this.serviceId} is already registered with Consul`,
      );
      return;
    }

    const token = this.getConsulToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['X-Consul-Token'] = token;
    }

    const payload = {
      ID: this.serviceId,
      Name: this.serviceName,
      Address: this.serviceAddress,
      Port: this.port,
      Check: {
        HTTP: `http://${this.serviceAddress}:${this.port}/api/health`,
        Interval: '10s',
        Timeout: '2s',
        DeregisterCriticalServiceAfter: this.deregisterCriticalServiceAfter,
      },
    };

    const url = `${this.consulUrl}/v1/agent/service/register`;
    const maxAttempts = 5;

    // Retry a few times if the local Consul agent is starting.
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'PUT',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(3000),
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          throw new Error(
            `Consul returned HTTP ${response.status}${errorBody ? `: ${errorBody}` : ''}`,
          );
        }

        this.registered = true;
        this.logger.log(
          `Registered ${this.serviceName} with Consul (ID: ${this.serviceId}, Port: ${this.port})`,
        );
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        this.logger.warn(
          `Consul registration attempt ${attempt}/${maxAttempts} failed: ${message}`,
        );

        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        }
      }
    }

    this.logger.error(
      `Consul registration failed after ${maxAttempts} attempts`,
    );

    if (this.isRequired) {
      throw new Error(
        `Consul registration failed after ${maxAttempts} attempts and CONSUL_REQUIRED=true`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.registered) return;

    const token = this.getConsulToken();
    const headers: Record<string, string> = {};

    if (token) {
      headers['X-Consul-Token'] = token;
    }

    try {
      const url = `${this.consulUrl}/v1/agent/service/deregister/${encodeURIComponent(this.serviceId)}`;

      const response = await fetch(url, {
        method: 'PUT',
        headers,
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(
          `HTTP ${response.status}${errorBody ? `: ${errorBody}` : ''}`,
        );
      }

      this.registered = false;
      this.logger.log(
        `Deregistered ${this.serviceName} from Consul (ID: ${this.serviceId})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Consul deregistration failed: ${message}`);
    }
  }
}
