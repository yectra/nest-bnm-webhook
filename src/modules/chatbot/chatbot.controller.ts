import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ChatbotService } from './chatbot.service';
import { ChatDto } from './dto/chat.dto';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('chatbot')
@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Public()
  @Post()
  @ApiOperation({
    summary: 'Send a message to the AI chat assistant',
    description:
      'Answers questions using data from the provided message and optional session. Authorization is optional; this endpoint is public and does not require a Bearer JWT token.',
  })
  async chat(@Body() dto: ChatDto) {
    const sessionId = dto.sessionId ?? 'anonymous-session';

    return this.chatbotService.chat(null, undefined, dto.message, sessionId);
  }
}
