import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Express } from 'express';
import { urlencoded } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { AZURE_B2C_SECURITY_SCHEME } from './common/constants';

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

  app.enableCors({
    origin: '*',
  });

  // Lets services flush in-flight work (for example pending LangSmith trace
  // batches) when the platform sends SIGTERM on restart or deploy.
  app.enableShutdownHooks();

  // Swagger is a public endpoint too; don't expose it in the main environment
  // (the default when APP_ENV is not set).
  if ((process.env.APP_ENV || 'main').toLowerCase() !== 'main') {
    const config = new DocumentBuilder()
      .setTitle('Company Backend')
      .setDescription(
        'Backend APIs. Every route requires an Azure AD B2C access token ' +
          '(Authorization: Bearer <token>) except the health probe and the ' +
          'third-party webhooks, which authenticate by their own means.',
      )
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Access token issued by the Azure AD B2C user flow for this API.',
        },
        AZURE_B2C_SECURITY_SCHEME,
      )
      // Makes the token the default for every operation in the UI; @Public()
      // routes simply ignore it.
      .addSecurityRequirements(AZURE_B2C_SECURITY_SCHEME)
      .build();

    const document = SwaggerModule.createDocument(app, config);

    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(process.env.PORT || 3000);
}

void bootstrap();
