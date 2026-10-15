import { ConfigService } from '@nestjs/config';
import { ConsulDiscoveryService } from './consul-discovery.service';

interface MockFetchRequestInit {
  method?: string;
  headers: Record<string, string>;
  body?: string;
}

describe('ConsulDiscoveryService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('throws an error if serviceName is empty', async () => {
    const service = new ConsulDiscoveryService();
    await expect(service.discoverService('')).rejects.toThrow(
      'Service name is required for discovery',
    );
    await expect(service.discoverService('   ')).rejects.toThrow(
      'Service name is required for discovery',
    );
  });

  it('discovers healthy service instances and falls back to Node.Address when Service.Address is omitted', async () => {
    const mockEntries = [
      {
        Service: {
          ID: 'api-1',
          Service: 'my-service',
          Address: '10.0.0.1',
          Port: 8080,
        },
        Node: { Address: '10.0.0.100' },
        Checks: [{ Status: 'passing' }, { Status: 'passing' }],
      },
      {
        Service: {
          ID: 'api-2',
          Service: 'my-service',
          Address: '', // Empty, should fallback to node address
          Port: 8081,
        },
        Node: { Address: '10.0.0.102' },
        Checks: [{ Status: 'passing' }],
      },
      {
        // Invalid port entry should be filtered out
        Service: {
          ID: 'api-invalid',
          Service: 'my-service',
          Address: '10.0.0.3',
          Port: -1,
        },
        Node: { Address: '10.0.0.103' },
        Checks: [{ Status: 'passing' }],
      },
    ];

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockEntries),
    });
    global.fetch = fetchMock;

    const config = new ConfigService({
      CONSUL_HTTP_ADDR: 'http://consul-cluster:8500/',
      CONSUL_HTTP_TOKEN: 'acl-token-123',
    });

    const service = new ConsulDiscoveryService(config);
    const results = await service.discoverService('my-service');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [
      string,
      MockFetchRequestInit,
    ];
    expect(url).toBe(
      'http://consul-cluster:8500/v1/health/service/my-service?passing',
    );
    expect(options.headers['X-Consul-Token']).toBe('acl-token-123');

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: 'api-1',
      name: 'my-service',
      address: '10.0.0.1',
      port: 8080,
      status: 'passing',
    });
    expect(results[1]).toEqual({
      id: 'api-2',
      name: 'my-service',
      address: '10.0.0.102',
      port: 8081,
      status: 'passing',
    });
  });

  it('returns an empty array when no instances are returned from Consul', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    });
    global.fetch = fetchMock;

    const service = new ConsulDiscoveryService();
    const results = await service.discoverService('non-existent-service');

    expect(results).toEqual([]);
  });

  it('returns empty array if Consul returns non-array data', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ error: 'unexpected format' }),
    });
    global.fetch = fetchMock;

    const service = new ConsulDiscoveryService();
    const results = await service.discoverService('some-service');

    expect(results).toEqual([]);
  });

  it('throws descriptive error when Consul returns an HTTP error code', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('rpc error: Internal error'),
    });
    global.fetch = fetchMock;

    const service = new ConsulDiscoveryService();
    await expect(service.discoverService('error-service')).rejects.toThrow(
      /Consul discovery failed: HTTP 500: rpc error: Internal error/,
    );
  });

  it('throws network error when fetch fails', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValue(new Error('Connection refused'));
    global.fetch = fetchMock;

    const service = new ConsulDiscoveryService();
    await expect(service.discoverService('any-service')).rejects.toThrow(
      /Consul discovery network error: Connection refused/,
    );
  });
});
