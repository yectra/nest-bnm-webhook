import { Injectable, Logger } from '@nestjs/common';
import { ConsulDiscoveryService } from './consul-discovery.service';

@Injectable()
export class ConsulHttpClientService {
  private readonly logger = new Logger(ConsulHttpClientService.name);

  constructor(private readonly discovery: ConsulDiscoveryService) {}

  async get<T>(serviceName: string, path: string): Promise<T> {
    if (!serviceName || !serviceName.trim()) {
      throw new Error('Service name is required');
    }

    // Prevent accidental absolute URLs, protocol smuggling, or path traversal
    if (
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('://')
    ) {
      throw new Error('Expected a relative API path starting with /');
    }

    const instances = await this.discovery.discoverService(serviceName);

    if (instances.length === 0) {
      throw new Error(`No healthy instances found for ${serviceName}`);
    }

    // Initial instance selection. Can be extended to round-robin if multiple instances exist.
    const instance = instances[0];

    if (
      !instance.address ||
      !instance.port ||
      instance.port <= 0 ||
      instance.port > 65535
    ) {
      throw new Error(
        `Discovered instance for ${serviceName} has invalid address or port`,
      );
    }

    const baseUrl = `http://${instance.address}:${instance.port}`;
    const targetUrl = `${baseUrl}${path}`;

    let response: Response;
    try {
      response = await fetch(targetUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `HTTP request to ${serviceName} at ${targetUrl} failed: ${message}`,
      );
      throw new Error(`Failed to communicate with ${serviceName}: ${message}`);
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(
        `${serviceName} returned HTTP ${response.status}${errorBody ? `: ${errorBody}` : ''}`,
      );
    }

    return (await response.json()) as T;
  }
}
