import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class CallbackService {
  private readonly logger = new Logger(CallbackService.name);

  handleStatusCallback(body: Record<string, string>) {
    this.logger.log(
      `Twilio status callback: sid=${body.MessageSid}, status=${body.MessageStatus}, to=${body.To}`,
    );
    console.log(`====STATUS_CALLBACK_BODY=====`, JSON.stringify(body, null, 2));
    return {
      success: true,
      sid: body.MessageSid,
      status: body.MessageStatus,
    };
  }
}
