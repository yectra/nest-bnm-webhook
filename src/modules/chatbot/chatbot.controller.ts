import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ChatbotService } from './chatbot.service';
import { ChatDto } from './dto/chat.dto';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

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

  // Authenticated endpoint – requires JWT and provides user context
  @UseGuards(JwtAuthGuard)
  @Post('auth')
  @ApiOperation({
    summary: 'Authenticated chat endpoint',
    description:
      'Chat endpoint that requires a valid Bearer JWT token. The token is decoded by JwtAuthGuard and the user information is injected via @CurrentUser. Provides userId and optional tenantId to the service for RBAC enforcement.',
  })
  async chatAuth(
    @Body() dto: ChatDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('tid') tenantId?: string,
  ) {
    const sessionId = dto.sessionId ?? `session-${userId}`;
    return this.chatbotService.chat(userId, tenantId, dto.message, sessionId);
  }
}
