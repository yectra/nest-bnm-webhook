import { UnauthorizedException } from '@nestjs/common';
import type { Socket } from 'socket.io';

import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface';
import { B2cTokenVerifierService } from './b2c-token-verifier.service';
import { WsAuthService } from './ws-auth.service';

describe('WsAuthService', () => {
  const user: AuthenticatedUser = {
    userId: 'user-object-id',
    subject: 'user-object-id',
    emails: [],
    scopes: [],
    roles: [],
    claims: { sub: 'user-object-id' },
  };

  let verify: jest.Mock;
  let service: WsAuthService;

  const buildClient = (handshake: Record<string, unknown>) => {
    const emit = jest.fn();
    const disconnect = jest.fn();
    const client = {
      id: 'socket-1',
      handshake: { auth: {}, headers: {}, query: {}, ...handshake },
      data: {} as Record<string, unknown>,
      emit,
      disconnect,
    } as unknown as Socket;

    return { client, emit, disconnect };
  };

  beforeEach(() => {
    verify = jest.fn().mockResolvedValue(user);
    service = new WsAuthService({
      verify,
    } as unknown as B2cTokenVerifierService);
  });

  it('reads the token from the Socket.IO auth payload', async () => {
    const { client } = buildClient({ auth: { token: 'a.valid.token' } });

    await expect(service.authenticate(client)).resolves.toBe(user);
    expect(verify).toHaveBeenCalledWith('a.valid.token');
  });

  it('accepts an auth payload that spells out the Bearer scheme', async () => {
    const { client } = buildClient({ auth: { token: 'Bearer a.valid.token' } });

    await service.authenticate(client);

    expect(verify).toHaveBeenCalledWith('a.valid.token');
  });

  it('falls back to the Authorization header', async () => {
    const { client } = buildClient({
      headers: { authorization: 'Bearer a.valid.token' },
    });

    await service.authenticate(client);

    expect(verify).toHaveBeenCalledWith('a.valid.token');
  });

  it('falls back to the token query parameter', async () => {
    const { client } = buildClient({ query: { token: 'a.valid.token' } });

    await service.authenticate(client);

    expect(verify).toHaveBeenCalledWith('a.valid.token');
  });

  it('keeps the caller on the socket for later messages', async () => {
    const { client } = buildClient({ auth: { token: 'a.valid.token' } });

    await service.authenticate(client);

    expect(service.getUser(client)).toBe(user);
  });

  it('rejects a handshake carrying no token', async () => {
    await expect(service.authenticate(buildClient({}).client)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it('closes the socket instead of throwing when asked to', async () => {
    verify.mockRejectedValue(
      new UnauthorizedException('Access token has expired'),
    );
    const { client, emit, disconnect } = buildClient({
      auth: { token: 'expired.token' },
    });

    await expect(
      service.authenticateOrDisconnect(client),
    ).resolves.toBeUndefined();
    expect(emit).toHaveBeenCalledWith('unauthorized', {
      message: 'Access token has expired',
    });
    expect(disconnect).toHaveBeenCalledWith(true);
  });

  it('closes a socket that presents no token at all', async () => {
    const { client, disconnect } = buildClient({});

    await expect(
      service.authenticateOrDisconnect(client),
    ).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalledWith(true);
  });

  it('leaves an authenticated socket connected', async () => {
    const { client, disconnect } = buildClient({
      auth: { token: 'a.valid.token' },
    });

    await expect(service.authenticateOrDisconnect(client)).resolves.toBe(user);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('reports no caller for a socket that never authenticated', () => {
    expect(service.getUser(buildClient({}).client)).toBeUndefined();
  });
});
