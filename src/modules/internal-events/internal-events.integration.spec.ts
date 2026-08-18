import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'http';

import internalEventsConfig from '../../config/internal-events.config';
import { InternalEventsModule } from './internal-events.module';

const KEY = 'k'.repeat(32);

const httpServer = (app: INestApplication): Server =>
  app.getHttpServer() as Server;

/** Boots the listener with the given environment, as the real app would. */
const createApp = async (
  env: Record<string, string | undefined>,
): Promise<INestApplication> => {
  const previous = { ...process.env };
  Object.assign(process.env, env);

  try {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [internalEventsConfig],
        }),
        InternalEventsModule,
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    return app;
  } finally {
    process.env = previous;
  }
};

describe('Internal event listener (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({
      INTERNAL_EVENTS_ENABLED: 'true',
      INTERNAL_EVENTS_KEY: KEY,
      INTERNAL_EVENTS_ALLOWED_CIDRS: '',
      INTERNAL_EVENTS_ALLOWED_ORIGIN: 'eventgrid.azure.net',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // supertest connects over loopback, which the guard treats as internal.
  it('greets an internal caller presenting the key', async () => {
    const response = await request(httpServer(app))
      .post('/api/internal/events/hello')
      .set('x-internal-event-key', KEY)
      .send([{ id: 'evt-1', eventType: 'Bnm.Hello' }])
      .expect(200);

    expect(response.body).toMatchObject({
      message: 'Hello, world',
      receivedCount: 1,
    });
  });

  it('answers the Event Grid validation handshake', async () => {
    const response = await request(httpServer(app))
      .post('/api/internal/events/hello')
      .set('x-internal-event-key', KEY)
      .send([
        {
          id: 'evt-2',
          eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent',
          data: { validationCode: 'code-abc' },
        },
      ])
      .expect(200);

    expect(response.body).toEqual({ validationResponse: 'code-abc' });
  });

  it('answers the CloudEvents abuse-protection handshake', async () => {
    const response = await request(httpServer(app))
      .options('/api/internal/events/hello')
      .set('x-internal-event-key', KEY)
      .set('WebHook-Request-Origin', 'eventgrid.azure.net')
      .expect(200);

    expect(response.headers['webhook-allowed-origin']).toBe(
      'eventgrid.azure.net',
    );
    expect(response.headers['webhook-allowed-rate']).toBe('120');
  });

  it('rejects a caller forwarded from a public address', async () => {
    await request(httpServer(app))
      .post('/api/internal/events/hello')
      .set('x-internal-event-key', KEY)
      .set('x-forwarded-for', '203.0.113.7:44321')
      .send([{ id: 'evt-3', eventType: 'Bnm.Hello' }])
      .expect(403);
  });

  it('rejects an internal caller without the key', async () => {
    await request(httpServer(app))
      .post('/api/internal/events/hello')
      .send([{ id: 'evt-4', eventType: 'Bnm.Hello' }])
      .expect(401);
  });

  it('serves the internal ping to authorised callers only', async () => {
    await request(httpServer(app))
      .get('/api/internal/events/hello')
      .set('x-internal-event-key', KEY)
      .expect(200, { message: 'Hello, world', listener: 'internal-events' });

    await request(httpServer(app))
      .get('/api/internal/events/hello')
      .expect(401);
  });

  it('is unavailable when the listener is disabled', async () => {
    const disabledApp = await createApp({
      INTERNAL_EVENTS_ENABLED: undefined,
      INTERNAL_EVENTS_KEY: KEY,
    });

    try {
      await request(httpServer(disabledApp))
        .post('/api/internal/events/hello')
        .set('x-internal-event-key', KEY)
        .send([{ id: 'evt-5', eventType: 'Bnm.Hello' }])
        .expect(503);
    } finally {
      await disabledApp.close();
    }
  });

  it('is unavailable when no key is configured', async () => {
    const unkeyedApp = await createApp({
      INTERNAL_EVENTS_ENABLED: 'true',
      INTERNAL_EVENTS_KEY: undefined,
    });

    try {
      await request(httpServer(unkeyedApp))
        .post('/api/internal/events/hello')
        .set('x-internal-event-key', KEY)
        .send([{ id: 'evt-6', eventType: 'Bnm.Hello' }])
        .expect(503);
    } finally {
      await unkeyedApp.close();
    }
  });
});
