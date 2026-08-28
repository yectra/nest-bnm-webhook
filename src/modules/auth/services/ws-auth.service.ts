import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Socket } from 'socket.io';

import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface';
import { extractBearerToken } from '../bearer-token.util';
import { B2cTokenVerifierService } from './b2c-token-verifier.service';

/**
 * Authenticates Socket.IO connections with the same Azure AD B2C tokens the
 * HTTP routes require.
 *
 * The gateways carry the same conversations as the REST endpoints, so
 * leaving the handshake open would be a way around the global HTTP guard.
 * Verification happens once, at connect time, and the caller is kept on
 * `socket.data.user` for the lifetime of the connection.
 */
@Injectable()
export class WsAuthService {
  private readonly logger = new Logger(WsAuthService.name);

  constructor(private readonly tokenVerifier: B2cTokenVerifierService) {}

  /**
   * Verifies the handshake credentials and remembers the caller on the
   * socket.
   *
   * @throws UnauthorizedException when no valid token was presented.
   */
  async authenticate(client: Socket): Promise<AuthenticatedUser> {
    const token = this.extractToken(client);

    if (!token) {
      throw new UnauthorizedException(
        'WebSocket handshake is missing an Azure AD B2C access token',
      );
    }

    const user = await this.tokenVerifier.verify(token);
    this.socketData(client).user = user;

    return user;
  }

  /**
   * Handshake authentication for `handleConnection`: closes the socket
   * instead of throwing, since a gateway cannot return an error response.
   *
   * @returns the caller, or `undefined` when the socket was rejected.
   */
  async authenticateOrDisconnect(
    client: Socket,
  ): Promise<AuthenticatedUser | undefined> {
    try {
      return await this.authenticate(client);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Rejected WebSocket client ${client.id}: ${reason}`);
      client.emit('unauthorized', { message: reason });
      client.disconnect(true);
      return undefined;
    }
  }

  /** The caller established at handshake time, if the socket is authenticated. */
  getUser(client: Socket): AuthenticatedUser | undefined {
    return this.socketData(client).user as AuthenticatedUser | undefined;
  }

  /** Socket.IO types `data` as `any`; keep the loose access in one place. */
  private socketData(client: Socket): Record<string, unknown> {
    return (client.data ?? {}) as Record<string, unknown>;
  }

  /**
   * Accepts the token from `io(url, { auth: { token } })`, from an
   * `Authorization` header, or from a `token` query parameter — the three
   * ways a browser Socket.IO client can carry one.
   */
  private extractToken(client: Socket): string | undefined {
    const handshake = client.handshake;

    const fromAuth = (handshake.auth as Record<string, unknown> | undefined)
      ?.token;
    if (typeof fromAuth === 'string' && fromAuth.trim()) {
      return extractBearerToken(fromAuth) ?? fromAuth.trim();
    }

    const fromHeader = extractBearerToken(handshake.headers?.authorization);
    if (fromHeader) {
      return fromHeader;
    }

    const fromQuery = handshake.query?.token;
    const queryToken = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
    if (typeof queryToken === 'string' && queryToken.trim()) {
      return extractBearerToken(queryToken) ?? queryToken.trim();
    }

    return undefined;
  }
}
