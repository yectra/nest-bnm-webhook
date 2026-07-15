import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WebhookService } from './webhook.service';

@ApiTags('Webhook')
@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
  ) {}

  @Post('whatsapp')
  async receiveWhatsappMessage(
    @Body() body: any,
  ) {
    return this.webhookService.receive(body);
  }
}