/* eslint-disable */
import {
    BadRequestException,
    Injectable,
    Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { twiml, validateRequest } from 'twilio';

@Injectable()
export class WebhookService {
    private readonly logger = new Logger(WebhookService.name);

    constructor(
        private readonly configService: ConfigService,
    ) { }

    private getRequestUrl(request: Request) {
        const forwardedProto = request.get('x-forwarded-proto');
        const protocol = forwardedProto ?? request.protocol;
        const host = request.get('host');

        return `${protocol}://${host}${request.originalUrl}`;
    }

    validateTwilioRequest(request: Request, body: Record<string, string>) {
        const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
        const webhookSecret = this.configService.get<string>('TWILIO_WEBHOOK_SECRET');
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

        const {
            Body,
            ProfileName,
        } = body;

        this.logger.log(`User : ${ProfileName}`);
        this.logger.log(`Message : ${Body}`);

        const response = new twiml.MessagingResponse();
        const name = ProfileName || 'there';
        const incomingText = Body || '';

        response.message(
            `Hello ${name}. We received your WhatsApp message.\n\nYou said:\n"${incomingText}"\n\nThanks for messaging us.`,
        );

        return {
            xml: response.toString(),
        };
    }

    handleStatusCallback(body: Record<string, string>) {
        this.logger.log(
            `Twilio status callback: sid=${body.MessageSid}, status=${body.MessageStatus}, to=${body.To}`,
        );

        return {
            success: true,
            sid: body.MessageSid,
            status: body.MessageStatus,
        };
    }
}
