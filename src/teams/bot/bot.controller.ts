import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TeamsService } from '../teams.service';
import { BotService } from './bot.service';

@Controller('messages')
export class BotController {
  constructor(
    private readonly teamsService: TeamsService,
    private readonly botService: BotService,
  ) {}

  @Post()
  async processMessage(@Req() req: Request, @Res() res: Response) {
    const adapter = this.teamsService.getAdapter();
    await adapter.process(req, res, (context) => this.botService.run(context));
  }
}
