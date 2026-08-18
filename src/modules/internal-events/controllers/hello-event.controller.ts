import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Options,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';

import { AzureInternalGuard } from '../../../common/guards/azure-internal.guard';
import type { InternalEvent } from '../interfaces/internal-event.interface';
import { HelloEventService } from '../services/hello-event.service';

/**
 * Internal-only "hello world" event listener.
 *
 * Every route is behind {@link AzureInternalGuard}, so it answers only callers
 * that reach the app from inside Azure (private endpoint, VNet integration,
 * loopback) *and* present the internal event key. It is excluded from Swagger
 * so it never shows up in the published API surface.
 */
@ApiExcludeController()
@UseGuards(AzureInternalGuard)
@Controller('internal/events')
export class HelloEventController {
  constructor(
    private readonly helloEventService: HelloEventService,
    private readonly config: ConfigService,
  ) {}

  /**
   * CloudEvents v1.0 abuse-protection handshake. Event Grid sends an OPTIONS
   * request with WebHook-Request-Origin before it starts delivering.
   */
  @Options('hello')
  @HttpCode(200)
  handshake(@Res({ passthrough: true }) response: Response): void {
    const allowedOrigin =
      this.config.get<string>('internalEvents.allowedOrigin') ??
      'eventgrid.azure.net';

    response.setHeader('WebHook-Allowed-Origin', allowedOrigin);
    response.setHeader('WebHook-Allowed-Rate', '120');
  }

  /** Liveness ping, so the listener can be verified from inside the VNet. */
  @Get('hello')
  ping() {
    return { message: 'Hello, world', listener: 'internal-events' };
  }

  /**
   * Receives events from Azure internals. Accepts the Event Grid schema (an
   * array of events) and CloudEvents v1.0 (a single event), and answers the
   * Event Grid subscription validation handshake.
   */
  @Post('hello')
  @HttpCode(200)
  receive(@Body() body: InternalEvent | InternalEvent[]) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Expected an event payload');
    }

    return this.helloEventService.handle(body);
  }
}
