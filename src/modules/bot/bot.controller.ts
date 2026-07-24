import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { BotAdapter } from './bot.adapter';
import { TeamsBot } from './teams.bot';

@Controller('messages')
export class BotController {
  constructor(
    private readonly adapter: BotAdapter,
    private readonly bot: TeamsBot,
  ) {}

  @Post()
  async messages(@Req() req: Request, @Res() res: Response) {
    await this.adapter.process(req, res, async (context) => {
      await this.bot.run(context);
    });
  }
}
