import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Express, Request } from 'express';
import { urlencoded } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const expressApp = app.getHttpAdapter().getInstance() as Express;

  expressApp.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.use(urlencoded({ extended: false }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // CORS stays open for the public API, but never for the internal-only
  // routes: browsers must not be able to read them cross-origin.
  const corsDelegate: CorsOptionsDelegate<Request> = (request, callback) => {
    const isInternalRoute = (request.url ?? '').startsWith('/api/internal');

    callback(null, isInternalRoute ? { origin: false } : { origin: '*' });
  };

  app.enableCors(corsDelegate);

  // Swagger is a public endpoint too; don't expose it in the main environment
  // (the default when APP_ENV is not set).
  if ((process.env.APP_ENV || 'main').toLowerCase() !== 'main') {
    const config = new DocumentBuilder()
      .setTitle('Company Backend')
      .setDescription('Backend APIs')
      .setVersion('1.0')
      .build();

    const document = SwaggerModule.createDocument(app, config);

    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(process.env.PORT || 3000);
}

void bootstrap();
