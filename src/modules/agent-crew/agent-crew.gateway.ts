import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { AgentCrewService } from './agent-crew.service';
import { CrewMessageDto } from './dto/crew-message.dto';
import { WebsiteRealtimeService } from '../chatbot/services/website-realtime.service';
import { WsAuthService } from '../auth/services/ws-auth.service';

/**
 * WebSocket entry/exit point for the agent crew. Clients join a session room
 * with `joinSession`, ask with `askCrew`, and receive the PII-filtered answer
 * both as the ack response and as a `crewResponse` room event.
 */
@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: 'api/agent-crew',
})
export class AgentCrewGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(AgentCrewGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(forwardRef(() => AgentCrewService))
    private readonly agentCrewService: AgentCrewService,
    private readonly websiteRealtimeService: WebsiteRealtimeService,
    private readonly wsAuth: WsAuthService,
  ) {}

  onModuleInit() {
    this.websiteRealtimeService.registerEmitter((record) => {
      this.logger.log(`[AgentCrewGateway] Received realtime event for conversationId=${record.conversationId}, source=${record.source}`);
      // If the record came from Teams, it was likely an agent reply/Teams reply
      // The frontend listens to "crewResponse" on this gateway.
      if (record.source === 'Teams') {
        this.logger.log(`[AgentCrewGateway] Emitting 'crewResponse' to session ${record.conversationId}`);
        const payload = {
          success: true,
          conversationId: record.conversationId,
          userId: record.userId,
          channel: record.channel,
          question: record.question,
          answer: record.answer,
          response: record.answer, // UI might expect response instead of answer
          timestamp: record.timestamp,
          isTeamsReply: true,
        };
        
        this.emitCrewResponse(record.conversationId, payload);
        
        // The UI might be listening for 'conversationUpdated' on this gateway too
        if (this.server) {
          this.server.to(record.conversationId).emit('conversationUpdated', record);
          this.server.emit('conversationUpdated', record);
        }
      }
    });
  }

  /**
   * The handshake carries the same Azure AD B2C access token the HTTP routes
   * require; without a valid one the socket is closed straight away, so the
   * gateway cannot be used to reach the crew around the global guard.
   */
  async handleConnection(client: Socket) {
    const user = await this.wsAuth.authenticateOrDisconnect(client);

    if (user) {
      this.logger.log(
        `Agent crew client connected: ${client.id} (userId=${user.userId})`,
      );
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Agent crew client disconnected: ${client.id}`);
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

  @SubscribeMessage('askCrew')
  async handleAskCrew(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: CrewMessageDto,
  ) {
    const user = this.wsAuth.getUser(client);
    const conversationId =
      dto.conversationId || dto.sessionId || `session-${client.id}`;
    void client.join(conversationId);
    return this.agentCrewService.run({
      ...dto,
      conversationId,
      userId: dto.userId || user?.userId,
      channel: dto.channel || 'Website',
    });
  }

  /** Emit the crew's final answer to the session room and all listeners. */
  emitCrewResponse(sessionId: string, payload: unknown) {
    if (this.server) {
      this.server.to(sessionId).emit('crewResponse', payload);
      this.server.emit('crewResponse', payload);
    }
  }
}
