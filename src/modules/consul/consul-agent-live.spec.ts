import { ConfigService } from '@nestjs/config';
import { ConsulRegistrationService } from './registration.service';

interface AgentServiceEntry {
  ID?: string;
  Service?: string;
}

describe('Consul Local Agent Live Integration', () => {
  let isConsulRunning = false;
  const consulAddr = 'http://127.0.0.1:8500';

  beforeAll(async () => {
    try {
      const res = await fetch(`${consulAddr}/v1/status/leader`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        isConsulRunning = true;
      }
    } catch {
      isConsulRunning = false;
    }
  });

  it('performs live registration and deregistration with local Consul agent', async () => {
    if (!isConsulRunning) {
      console.warn(
        'Local Consul agent is not running on 127.0.0.1:8500; skipping live integration test.',
      );
      return;
    }

    const testServiceId = `test-integration-service-${Date.now()}`;
    const testServiceName = 'test-integration-service';

    const config = new ConfigService({
      CONSUL_ENABLED: true,
      CONSUL_HTTP_ADDR: consulAddr,
      CONSUL_SERVICE_ID: testServiceId,
      CONSUL_SERVICE_NAME: testServiceName,
      CONSUL_SERVICE_ADDRESS: '127.0.0.1',
      PORT: 3000,
      CONSUL_DEREGISTER_CRITICAL_AFTER: '1m',
    });

    const registrationService = new ConsulRegistrationService(config);

    // 1. Register
    await registrationService.register();
    expect(registrationService.isRegistered()).toBe(true);

    // 2. Query local agent services to verify presence
    await new Promise((r) => setTimeout(r, 200));
    const agentServicesRes = await fetch(`${consulAddr}/v1/agent/services`);
    const agentServices = (await agentServicesRes.json()) as Record<
      string,
      AgentServiceEntry
    >;
    expect(agentServices[testServiceId]).toBeDefined();
    expect(agentServices[testServiceId]?.Service).toBe(testServiceName);

    // 3. Deregister on shutdown
    await registrationService.onApplicationShutdown();
    expect(registrationService.isRegistered()).toBe(false);

    // Verify deregistered from local agent
    await new Promise((r) => setTimeout(r, 200));
    const agentServicesAfter = (await (
      await fetch(`${consulAddr}/v1/agent/services`)
    ).json()) as Record<string, AgentServiceEntry>;
    expect(agentServicesAfter[testServiceId]).toBeUndefined();
  });
});
