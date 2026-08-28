import { Global, Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AzureB2cAuthGuard } from './guards/azure-b2c-auth.guard';
import { B2cDiscoveryService } from './services/b2c-discovery.service';
import { B2cTokenVerifierService } from './services/b2c-token-verifier.service';
import { WsAuthService } from './services/ws-auth.service';

/**
 * Azure AD B2C authentication for the whole application.
 *
 * Global so that the guard registered under `APP_GUARD` in `AppModule` and
 * the WebSocket gateways can resolve the verifier without every feature
 * module importing this one.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [
    B2cDiscoveryService,
    B2cTokenVerifierService,
    WsAuthService,
    AzureB2cAuthGuard,
  ],
  exports: [
    B2cDiscoveryService,
    B2cTokenVerifierService,
    WsAuthService,
    AzureB2cAuthGuard,
  ],
})
export class AuthModule {}
