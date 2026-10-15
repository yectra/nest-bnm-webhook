import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ConsulModule } from './consul.module';
import { ConsulRegistrationService } from './registration.service';
import { ConsulDiscoveryService } from './consul-discovery.service';
import { ConsulHttpClientService } from './consul-http-client.service';

describe('ConsulModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              CONSUL_ENABLED: false,
              CONSUL_HTTP_ADDR: 'http://127.0.0.1:8500',
            }),
          ],
        }),
        ConsulModule,
      ],
    }).compile();
  });

  it('should compile and provide ConsulRegistrationService', () => {
    const service = module.get<ConsulRegistrationService>(
      ConsulRegistrationService,
    );
    expect(service).toBeDefined();
    expect(service.isRegistered()).toBe(false);
  });

  it('should compile and provide ConsulDiscoveryService', () => {
    const service = module.get<ConsulDiscoveryService>(ConsulDiscoveryService);
    expect(service).toBeDefined();
  });

  it('should compile and provide ConsulHttpClientService', () => {
    const service = module.get<ConsulHttpClientService>(
      ConsulHttpClientService,
    );
    expect(service).toBeDefined();
  });
});
