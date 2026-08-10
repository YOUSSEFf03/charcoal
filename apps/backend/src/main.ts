import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { parseCorsOrigins } from './common/utils/cors.utils';
import { isDevAuthBypassEnabled } from './auth/auth.guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Raw body is required for Svix webhook signature verification.
    rawBody: true,
  });

  if (isDevAuthBypassEnabled()) {
    // Loud and impossible to miss in deployment logs — if this appears on a
    // real deployment, DEV_AUTH_BYPASS_ENABLED and/or NODE_ENV are wrong.
    // eslint-disable-next-line no-console
    console.warn(
      '\n*** DEV AUTH BYPASS IS ACTIVE — "Authorization: Bearer dev:<role>" grants unauthenticated access to any role. NEVER enable this in a deployed environment. ***\n',
    );
  }

  const configService = app.get(ConfigService);

  const rawOrigins = configService.get<string>('CORS_ORIGINS') ?? 'http://localhost:5173';
  app.enableCors({
    origin: parseCorsOrigins(rawOrigins),
    credentials: true,
  });

  // /health and /webhooks/clerk must NOT carry the api/v1 prefix.
  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'webhooks/clerk'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      errorHttpStatusCode: 422,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Charcoal Business API')
    .setDescription('Charcoal Business Accounting System')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get<number>('PORT') ?? 3001;
  await app.listen(port);
}
bootstrap().catch((err: unknown) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
