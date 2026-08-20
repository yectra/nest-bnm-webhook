import { Body, Controller, Header, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';

import { WebhookService } from '../services/webhook.service';
import { CallbackService } from '../services/callback.service';
import { EventGridService } from '../services/event-grid.service';
import { EventSecurityGuard } from '../../../common/guards/event-security.guard';
import { Public } from '../../../common/decorators/public.decorator';

@ApiTags('Webhook')
@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly callbackService: CallbackService,
    private readonly eventGridService: EventGridService,
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

  @Public()
  @Post('event-grid')
  @UseGuards(EventSecurityGuard)
  receiveEventGridEvent(@Body() body: any) {
    return this.eventGridService.processEvent(body);
  }
}
