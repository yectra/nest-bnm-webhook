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
import { WsAuthService } from '../../auth/services/ws-auth.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/api/chatbot',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(forwardRef(() => ChatbotService))
    private readonly chatbotService: ChatbotService,
    private readonly wsAuth: WsAuthService,
  ) {}

  /**
   * The handshake carries the same Azure AD B2C access token the HTTP routes
   * require; without a valid one the socket is closed straight away, so the
   * gateway cannot be used to reach the chatbot around the global guard.
   */
  async handleConnection(client: Socket) {
    const user = await this.wsAuth.authenticateOrDisconnect(client);

    if (user) {
      this.logger.log(
        `Website client connected: ${client.id} (userId=${user.userId})`,
      );
    }
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
    const user = this.wsAuth.getUser(client);
    const conversationId =
      dto.conversationId || dto.sessionId || `session-${client.id}`;
    const result = await this.chatbotService.processMessage({
      ...dto,
      conversationId,
      userId: dto.userId || user?.userId,
      tenantId: dto.tenantId || user?.tenantId,
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

  emitDirectLineActivity(sessionId: string, activity: unknown) {
    if (this.server) {
      this.server.to(sessionId).emit('activity', activity);
      this.server.emit('activity', activity);
    }
  }
}
