import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as NestLogger, ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { RedisService } from './redis/redis.service';
import { resolveTrustProxy } from './common/config/trust-proxy.config';

// Safety net: a rejected promise with no local catch (e.g. a transient backend blip
// inside a fire-and-forget path) must be logged, never crash the process. Individual
// call sites still handle their own errors; this only stops an escaped rejection from
// taking the API down.
process.on('unhandledRejection', (reason) => {
  new NestLogger('unhandledRejection').error(reason instanceof Error ? reason.stack : String(reason));
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  // Log how Redis is wired so an operator can see single-node vs multi-node at a glance.
  const redis = app.get(RedisService);
  const { enabled, mode, clusterMode } = redis.describe();
  new NestLogger('Bootstrap').log(
    `Redis: ${enabled ? 'enabled' : 'disabled'} (mode=${mode}, clusterMode=${clusterMode})`,
  );

  // Trust the proxy chain so req.ip is the real client (per-IP AI rate limiting
  // + Network.checkOnHome). Defaults to 1 hop — a single LB/Caddy in front (the
  // DigitalOcean App Platform LB, or one Caddy hop); locally there is no proxy so
  // it's inert. Set TRUST_PROXY (hop count, 'true'/'false', or an IP/subnet/preset)
  // for a longer chain such as Cloudflare Tunnel → Caddy → API.
  app.set('trust proxy', resolveTrustProxy(process.env.TRUST_PROXY));

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
