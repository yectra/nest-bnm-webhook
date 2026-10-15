import { Module } from '@nestjs/common';
import { ConsulRegistrationService } from './registration.service';
import { ConsulDiscoveryService } from './consul-discovery.service';
import { ConsulHttpClientService } from './consul-http-client.service';

@Module({
  providers: [
    ConsulRegistrationService,
    ConsulDiscoveryService,
    ConsulHttpClientService,
  ],
  exports: [
    ConsulRegistrationService,
    ConsulDiscoveryService,
    ConsulHttpClientService,
  ],
})
export class ConsulModule {}
