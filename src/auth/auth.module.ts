import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EntraIdStrategy } from './strategies/entra-id.strategy';
import { EventGridEventValidator } from './events/event-grid-event.validator';
import { EventGridAuthGuard } from './guards/event-grid-auth.guard';

@Module({
  imports: [ConfigModule],
  providers: [EntraIdStrategy, EventGridEventValidator, EventGridAuthGuard],
  exports: [EntraIdStrategy, EventGridEventValidator, EventGridAuthGuard],
})
export class AuthModule {}
