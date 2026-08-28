import { Body, Controller, Get, Logger, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChatbotService } from './chatbot.service';
import { ChatMessageDto } from './dto/chat-message.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ConversationRepository } from './repositories/conversation.repository';

@ApiTags('chatbot')
@ApiBearerAuth()
@Controller('chatbot')
export class ChatbotController {
  private readonly logger = new Logger(ChatbotController.name);

  constructor(
    private readonly chatbotService: ChatbotService,
    private readonly conversationRepository: ConversationRepository,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Send a message to the AI Chatbot backend (Website Chat UI)',
    description:
      'Processes a message through the single ChatbotService orchestrator, runs vector search, generates AI response, stores conversation, and synchronizes real-time channels. Requires an Azure AD B2C access token.',
  })
  async chat(
    @Body() dto: ChatMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.logger.log(
      `Received POST /api/chatbot request from userId=${user.userId}: ${JSON.stringify(dto)}`,
    );
    return this.chatbotService.processMessage({
      ...dto,
      // The signed-in user identifies the conversation unless the client
      // sends an application-level user ID of its own.
      userId: dto.userId || user.userId,
      tenantId: dto.tenantId || user.tenantId,
      channel: dto.channel || 'Website',
    });
  }

  /**
   * Kept for clients still pointing at the explicitly authenticated path.
   * Since every route now requires an Azure AD B2C token, it behaves exactly
   * like POST /api/chatbot except that the token's identity always wins.
   */
  @Post('auth')
  @ApiOperation({
    summary: 'Authenticated chat endpoint for Website Chat UI',
    description:
      'Identical to POST /api/chatbot, except the user and tenant always come from the Azure AD B2C access token rather than the request body.',
  })
  async chatAuth(
    @Body() dto: ChatMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.logger.log(
      `Received authenticated POST /api/chatbot/auth for userId=${user.userId}`,
    );
    return this.chatbotService.processMessage({
      ...dto,
      userId: user.userId,
      tenantId: user.tenantId,
      channel: dto.channel || 'Website',
    });
  }

  @Get('history/:conversationId')
  @ApiOperation({
    summary: 'Get conversation history for both Website and Teams',
    description:
      'Retrieves unified conversation history stored for a given conversationId. Requires an Azure AD B2C access token.',
  })
  getHistory(@Param('conversationId') conversationId: string) {
    return {
      success: true,
      conversationId,
      history: this.conversationRepository.getHistory(conversationId),
    };
  }
}
