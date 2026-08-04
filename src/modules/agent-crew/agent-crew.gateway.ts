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
import { AgentCrewService } from './agent-crew.service';
import { CrewMessageDto } from './dto/crew-message.dto';

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
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(AgentCrewGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(forwardRef(() => AgentCrewService))
    private readonly agentCrewService: AgentCrewService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Agent crew client connected: ${client.id}`);
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
    const conversationId =
      dto.conversationId || dto.sessionId || `session-${client.id}`;
    void client.join(conversationId);
    return this.agentCrewService.run({
      ...dto,
      conversationId,
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
