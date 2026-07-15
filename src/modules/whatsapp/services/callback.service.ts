import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class CallbackService {
  private readonly logger = new Logger(CallbackService.name);

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
