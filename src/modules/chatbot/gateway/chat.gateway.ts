import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ChatbotService } from '../chatbot.service';
import { ChatMessageDto } from '../dto/chat-message.dto';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: 'chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(forwardRef(() => ChatbotService))
    private readonly chatbotService: ChatbotService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Website client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Website client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinSession')
  handleJoinSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId?: string; conversationId?: string },
  ) {
    const session = data.sessionId || data.conversationId;
    if (session) {
      void client.join(session);
      this.logger.log(`Client ${client.id} joined session room "${session}"`);
    }
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ChatMessageDto,
  ) {
    const conversationId = dto.conversationId || dto.sessionId || `session-${client.id}`;
    const result = await this.chatbotService.processMessage({
      ...dto,
      conversationId,
      channel: 'Website',
    });

    return result;
  }

  /** Emit real-time event to connected website clients */
  emitToAll(event: string, payload: unknown) {
    if (this.server) {
      this.server.emit(event, payload);
    }
  }

  /** Emit real-time event to specific room/session */
  emitToSession(sessionId: string, event: string, payload: unknown) {
    if (this.server) {
      this.server.to(sessionId).emit(event, payload);
      // Also broadcast globally so all listening website windows update instantly
      this.server.emit(event, payload);
    }
  }
}
