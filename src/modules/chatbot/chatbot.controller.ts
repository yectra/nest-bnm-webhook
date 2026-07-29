import { Body, Controller, Get, Logger, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChatbotService } from './chatbot.service';
import { ChatMessageDto } from './dto/chat-message.dto';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConversationRepository } from './repositories/conversation.repository';

@ApiTags('chatbot')
@Controller('chatbot')
export class ChatbotController {
  private readonly logger = new Logger(ChatbotController.name);

  constructor(
    private readonly chatbotService: ChatbotService,
    private readonly conversationRepository: ConversationRepository,
  ) {}

  @Public()
  @Post()
  @ApiOperation({
    summary: 'Send a message to the AI Chatbot backend (Website Chat UI)',
    description:
      'Processes a message through the single ChatbotService orchestrator, runs vector search, generates AI response, stores conversation, and synchronizes real-time channels.',
  })
  async chat(@Body() dto: ChatMessageDto) {
    this.logger.log(`Received POST /api/chatbot request: ${JSON.stringify(dto)}`);
    return this.chatbotService.processMessage({
      ...dto,
      channel: dto.channel || 'Website',
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('auth')
  @ApiOperation({
    summary: 'Authenticated chat endpoint for Website Chat UI',
    description:
      'Requires Bearer JWT token. Injects user ID context from JWT token into ChatbotService.',
  })
  async chatAuth(
    @Body() dto: ChatMessageDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('tid') tenantId?: string,
  ) {
    this.logger.log(`Received authenticated POST /api/chatbot/auth for userId=${userId}`);
    return this.chatbotService.processMessage({
      ...dto,
      userId,
      tenantId,
      channel: dto.channel || 'Website',
    });
  }

  @Public()
  @Get('history/:conversationId')
  @ApiOperation({
    summary: 'Get conversation history for both Website and Teams',
    description: 'Retrieves unified conversation history stored for a given conversationId.',
  })
  getHistory(@Param('conversationId') conversationId: string) {
    return {
      success: true,
      conversationId,
      history: this.conversationRepository.getHistory(conversationId),
    };
  }
}
