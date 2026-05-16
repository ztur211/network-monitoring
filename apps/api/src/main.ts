import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

  // CSP whitelist per SAD §12.4: self + OpenFreeMap tiles + Nominatim geocoder.
  // Anthropic API is server-to-server only (never called from the browser), so
  // it is not in connect-src. NestJS responses (REST + Better Auth) are same-origin.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'img-src': ["'self'", 'data:', 'blob:', 'https://tiles.openfreemap.org'],
          'connect-src': [
            "'self'",
            'https://tiles.openfreemap.org',
            'https://nominatim.openstreetmap.org',
          ],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'worker-src': ["'self'", 'blob:'],
          'frame-ancestors': ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());

  if (!process.env.FRONTEND_URL) {
    throw new Error('FRONTEND_URL must be set — CORS will reject every browser request without it.');
  }
  app.enableCors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

bootstrap();
