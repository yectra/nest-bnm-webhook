/* eslint-disable prettier/prettier */
import { Body, Controller, Header, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';

import { WebhookService } from './webhook.service';

@ApiTags('Webhook')
@Controller('webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('whatsapp')
  @Header('Content-Type', 'text/xml')
  async receiveWhatsappMessage(
    @Req() request: Request,
    @Body() body?: Record<string, string>,
  ) {
    const response = await this.webhookService.receive(request, body ?? {});

    return response.xml;
  }

  @Post('whatsapp/status')
  receiveWhatsappStatus(@Body() body: Record<string, string>) {
    return this.webhookService.handleStatusCallback(body);
  }
}
