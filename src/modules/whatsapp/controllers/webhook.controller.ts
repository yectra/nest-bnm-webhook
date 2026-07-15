import { Body, Controller, Header, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';

import { WebhookService } from '../services/webhook.service';
import { CallbackService } from '../services/callback.service';

@ApiTags('Webhook')
@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly callbackService: CallbackService,
  ) {}

  @Post('whatsapp')
  @Header('Content-Type', 'text/xml')
  receiveWhatsappMessage(
    @Req() request: Request,
    @Body() body?: Record<string, string>,
  ) {
    const response = this.webhookService.receive(request, body ?? {});

    return response.xml;
  }

  @Post('whatsapp/status')
  receiveWhatsappStatus(@Body() body: Record<string, string>) {
    return this.callbackService.handleStatusCallback(body);
  }
}
