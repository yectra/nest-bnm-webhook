import {
  ConsulDiscoveryService,
  DiscoveredService,
} from './consul-discovery.service';
import { ConsulHttpClientService } from './consul-http-client.service';

describe('ConsulHttpClientService', () => {
  const originalFetch = global.fetch;
  let mockDiscovery: jest.Mocked<ConsulDiscoveryService>;
  let client: ConsulHttpClientService;

  beforeEach(() => {
    mockDiscovery = {
      discoverService: jest.fn(),
    } as unknown as jest.Mocked<ConsulDiscoveryService>;

    client = new ConsulHttpClientService(mockDiscovery);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('rejects empty or whitespace service name', async () => {
    await expect(client.get('', '/api/test')).rejects.toThrow(
      'Service name is required',
    );
  });

  it('rejects invalid, absolute, or non-relative paths', async () => {
    await expect(
      client.get('my-service', 'https://malicious.com/api'),
    ).rejects.toThrow('Expected a relative API path starting with /');

    await expect(
      client.get('my-service', '//protocol-relative/api'),
    ).rejects.toThrow('Expected a relative API path starting with /');

    await expect(client.get('my-service', 'api/test')).rejects.toThrow(
      'Expected a relative API path starting with /',
    );
  });

  it('throws when no healthy instances are found', async () => {
    mockDiscovery.discoverService.mockResolvedValue([]);

    await expect(client.get('orders-service', '/api/orders')).rejects.toThrow(
      'No healthy instances found for orders-service',
    );
  });

  it('throws when discovered instance has invalid address or port', async () => {
    mockDiscovery.discoverService.mockResolvedValue([
      {
        id: 'bad-1',
        name: 'orders-service',
        address: '',
        port: 0,
        status: 'passing',
      },
    ]);

    await expect(client.get('orders-service', '/api/orders')).rejects.toThrow(
      'Discovered instance for orders-service has invalid address or port',
    );
  });

  it('successfully fetches data from the discovered service', async () => {
    const mockService: DiscoveredService = {
      id: 'orders-1',
      name: 'orders-service',
      address: '10.0.0.5',
      port: 8080,
      status: 'passing',
    };
    mockDiscovery.discoverService.mockResolvedValue([mockService]);

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ orderId: '12345', amount: 99.99 }),
    });
    global.fetch = fetchMock;

    interface OrderResponse {
      orderId: string;
      amount: number;
    }

    const response = await client.get<OrderResponse>(
      'orders-service',
      '/api/orders/12345',
    );

    expect(response).toEqual({ orderId: '12345', amount: 99.99 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://10.0.0.5:8080/api/orders/12345');
  });

  it('throws when upstream service returns HTTP error status', async () => {
    mockDiscovery.discoverService.mockResolvedValue([
      {
        id: 'orders-1',
        name: 'orders-service',
        address: '10.0.0.5',
        port: 8080,
        status: 'passing',
      },
    ]);

    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Order not found'),
    });
    global.fetch = fetchMock;

    await expect(
      client.get('orders-service', '/api/orders/missing'),
    ).rejects.toThrow('orders-service returned HTTP 404: Order not found');
  });
});
