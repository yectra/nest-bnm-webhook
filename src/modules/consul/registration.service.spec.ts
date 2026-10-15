import { ConfigService } from '@nestjs/config';
import { ConsulRegistrationService } from './registration.service';

interface MockFetchRequestInit {
  method?: string;
  headers: Record<string, string>;
  body?: string;
}

interface ServiceRegistrationPayload {
  ID: string;
  Name: string;
  Address: string;
  Port: number;
  Check: {
    HTTP: string;
    Interval: string;
    Timeout: string;
    DeregisterCriticalServiceAfter?: string;
  };
}

describe('ConsulRegistrationService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    delete process.env.CONSUL_ENABLED;
    delete process.env.CONSUL_HTTP_ADDR;
    delete process.env.CONSUL_HTTP_TOKEN;
    delete process.env.CONSUL_SERVICE_ID;
    delete process.env.CONSUL_SERVICE_NAME;
    delete process.env.CONSUL_SERVICE_ADDRESS;
    delete process.env.CONSUL_REQUIRED;
    delete process.env.PORT;
  });

  it('does not register when CONSUL_ENABLED is false', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const config = new ConfigService({
      CONSUL_ENABLED: false,
    });

    const service = new ConsulRegistrationService(config);
    await service.register();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(service.isRegistered()).toBe(false);
  });

  it('registers successfully with correct payload and headers when enabled', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    global.fetch = fetchMock;

    const config = new ConfigService({
      CONSUL_ENABLED: true,
      CONSUL_HTTP_ADDR: 'http://127.0.0.1:8500',
      CONSUL_HTTP_TOKEN: 'secret-acl-token',
      CONSUL_SERVICE_ID: 'test-service-1',
      CONSUL_SERVICE_NAME: 'test-service',
      CONSUL_SERVICE_ADDRESS: '192.168.1.50',
      PORT: 4000,
      CONSUL_DEREGISTER_CRITICAL_AFTER: '2m',
    });

    const service = new ConsulRegistrationService(config);
    await service.register();

    expect(service.isRegistered()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0] as [
      string,
      MockFetchRequestInit,
    ];
    expect(url).toBe('http://127.0.0.1:8500/v1/agent/service/register');
    expect(options.method).toBe('PUT');
    expect(options.headers['X-Consul-Token']).toBe('secret-acl-token');
    expect(options.headers['Content-Type']).toBe('application/json');

    const payload = JSON.parse(
      options.body ?? '{}',
    ) as ServiceRegistrationPayload;
    expect(payload.ID).toBe('test-service-1');
    expect(payload.Name).toBe('test-service');
    expect(payload.Address).toBe('192.168.1.50');
    expect(payload.Port).toBe(4000);
    expect(payload.Check.HTTP).toBe('http://192.168.1.50:4000/api/health');
    expect(payload.Check.Interval).toBe('10s');
    expect(payload.Check.Timeout).toBe('2s');
    expect(payload.Check.DeregisterCriticalServiceAfter).toBe('2m');
  });

  it('is idempotent when register() is called multiple times', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    global.fetch = fetchMock;

    const config = new ConfigService({
      CONSUL_ENABLED: true,
    });

    const service = new ConsulRegistrationService(config);
    await service.register();
    await service.register();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(service.isRegistered()).toBe(true);
  });

  it('retries up to 5 times on transient failures and respects optional startup policy', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Agent not ready'),
    });
    global.fetch = fetchMock;

    const setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((cb: () => void) => {
        cb();
        return 0 as unknown as NodeJS.Timeout;
      });

    const config = new ConfigService({
      CONSUL_ENABLED: true,
      CONSUL_REQUIRED: false,
    });

    const service = new ConsulRegistrationService(config);
    // Should NOT throw because CONSUL_REQUIRED is false
    await expect(service.register()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(service.isRegistered()).toBe(false);

    setTimeoutSpy.mockRestore();
  });

  it('throws an error if registration fails and CONSUL_REQUIRED is true', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Fatal cluster failure'),
    });
    global.fetch = fetchMock;

    const setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((cb: () => void) => {
        cb();
        return 0 as unknown as NodeJS.Timeout;
      });

    const config = new ConfigService({
      CONSUL_ENABLED: true,
      CONSUL_REQUIRED: true,
    });

    const service = new ConsulRegistrationService(config);
    await expect(service.register()).rejects.toThrow(
      /Consul registration failed after 5 attempts and CONSUL_REQUIRED=true/,
    );

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(service.isRegistered()).toBe(false);

    setTimeoutSpy.mockRestore();
  });

  it('deregisters cleanly on application shutdown', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 }) // register
      .mockResolvedValueOnce({ ok: true, status: 200 }); // deregister
    global.fetch = fetchMock;

    const config = new ConfigService({
      CONSUL_ENABLED: true,
      CONSUL_SERVICE_ID: 'svc-to-deregister',
      CONSUL_HTTP_TOKEN: 'token-abc',
    });

    const service = new ConsulRegistrationService(config);
    await service.register();
    expect(service.isRegistered()).toBe(true);

    await service.onApplicationShutdown();
    expect(service.isRegistered()).toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [deregisterUrl, deregisterOptions] = fetchMock.mock.calls[1] as [
      string,
      MockFetchRequestInit,
    ];
    expect(deregisterUrl).toBe(
      'http://127.0.0.1:8500/v1/agent/service/deregister/svc-to-deregister',
    );
    expect(deregisterOptions.method).toBe('PUT');
    expect(deregisterOptions.headers['X-Consul-Token']).toBe('token-abc');

    // Subsequent shutdown calls should be no-ops
    await service.onApplicationShutdown();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not deregister if service was never registered', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const config = new ConfigService({
      CONSUL_ENABLED: false,
    });

    const service = new ConsulRegistrationService(config);
    await service.onApplicationShutdown();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
