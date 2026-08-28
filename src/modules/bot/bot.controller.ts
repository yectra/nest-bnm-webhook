import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { BotAdapter } from './bot.adapter';
import { TeamsBot } from './teams.bot';
import { Public } from '../../common/decorators/public.decorator';

@Controller('messages')
export class BotController {
  constructor(
    private readonly adapter: BotAdapter,
    private readonly bot: TeamsBot,
  ) {}

  // The Bot Framework service calls this endpoint with its own signed JWT,
  // which the adapter validates; a B2C user token is never present here.
  @Public()
  @Post()
  async messages(@Req() req: Request, @Res() res: Response) {
    console.log('=== BOT CONTROLLER HIT ===');

    try {
      await this.adapter.process(req, res, async (context) => {
        console.log('Activity:', context.activity.type);
        await this.bot.run(context);
      });
    } catch (err) {
      console.error('BOT ERROR:', err);
      throw err;
    }
  }
}
