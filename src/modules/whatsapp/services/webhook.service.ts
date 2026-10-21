import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { twiml, validateRequest } from 'twilio';
import { WhatsAppSenderPolicyService } from '../../token-budget/whatsapp-sender-policy.service';
import { TokenBudgetService } from '../../token-budget/token-budget.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly senderPolicyService?: WhatsAppSenderPolicyService,
    @Optional() private readonly tokenBudgetService?: TokenBudgetService,
  ) {}

  private getRequestUrl(request: Request) {
    const forwardedProto = request.get('x-forwarded-proto');
    const protocol = forwardedProto ?? request.protocol;
    const host = request.get('host');

    return `${protocol}://${host}${request.originalUrl}`;
  }

  validateTwilioRequest(request: Request, body: Record<string, string>) {
    console.log(`====VALIDATE_WEBHOOK_BODY====`, JSON.stringify(body, null, 2));
    console.log(`===VALIDATE_WEBHOOK_REQUEST===`, request);
    const authToken =
      this.configService.get<string>('twilio.authToken') ||
      this.configService.get<string>('TWILIO_AUTH_TOKEN');
    const webhookSecret =
      this.configService.get<string>('twilio.webhookSecret') ||
      this.configService.get<string>('TWILIO_WEBHOOK_SECRET');
    const signature = request.get('x-twilio-signature');

    if (!signature) {
      throw new BadRequestException('Missing Twilio signature header.');
    }

    if (webhookSecret && signature !== webhookSecret) {
      throw new BadRequestException('Invalid webhook secret.');
    }

    const isValid = validateRequest(
      authToken ?? '',
      signature,
      this.getRequestUrl(request),
      body,
    );

    if (!isValid) {
      throw new BadRequestException('Invalid Twilio request signature.');
    }
  }

  async receive(request: Request, body?: Record<string, string>) {
    if (!body || Object.keys(body).length === 0) {
      throw new BadRequestException(
        'Webhook payload is missing. Send x-www-form-urlencoded fields like Body, From, and ProfileName.',
      );
    }

    this.validateTwilioRequest(request, body);

    const { Body, ProfileName, From } = body;
    const response = new twiml.MessagingResponse();

    // 1. WhatsApp sender policy check
    if (this.senderPolicyService) {
      const senderCheck = this.senderPolicyService.validateSender(From);
      if (!senderCheck.allowed) {
        this.logger.warn(
          `AI_SENDER_NOT_ALLOWED: sender rejected (${senderCheck.maskedSender}); event skipped. Reason: ${senderCheck.reason}`,
        );
        return {
          xml: response.toString(),
        };
      }
    }

    // 2. Token budget availability check
    if (this.tokenBudgetService) {
      const budgetCheck = await this.tokenBudgetService.checkBudgetAvailable(500);
      if (!budgetCheck.allowed) {
        this.logger.warn(
          `AI_TOKEN_BUDGET_EXHAUSTED: rolling 24-hour token limit reached; event skipped. sender=${
            From ? this.senderPolicyService?.maskPhoneNumber(From) : 'unknown'
          }, remaining=${budgetCheck.remainingTokens}, limit=${budgetCheck.limit}`,
        );
        return {
          xml: response.toString(),
        };
      }
    }

    this.logger.log(`User : ${ProfileName}`);
    this.logger.log(`Message : ${Body}`);

    const name = ProfileName || 'there';
    const incomingText = Body || '';

    response.message(
      `Hello ${name}. We received your WhatsApp message.\n\nYou said:\n"${incomingText}"\n\nThanks for messaging us.`,
    );
    console.log(`=======WEBHOOK BODY=========`, JSON.stringify(body, null, 2));
    console.log(`=======WEBHOOK REQUEST======`, request);
    return {
      xml: response.toString(),
    };
  }
}
