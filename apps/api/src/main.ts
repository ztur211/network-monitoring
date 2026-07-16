import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as NestLogger, ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { RedisService } from './redis/redis.service';
import { resolveTrustProxy } from './common/config/trust-proxy.config';
import { INGEST_BODY_LIMIT } from './monitoring/ingest/ingest.dto';
import { closeAppOnBootstrapFailure, enableShutdownHooks } from './common/lifecycle/shutdown-hooks';

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
  try {
    enableShutdownHooks(app);

  app.useLogger(app.get(Logger));

  // Body size is a stated contract, not an accident. Nest passes no `limit` to express.json(),
  // so body-parser's 100 kB DEFAULT applied silently - and the monitoring ingest endpoint, whose
  // batches grow with the customer's fleet, quietly started 413ing at roughly 800 devices while
  // the agent threw the rejected batches away. Set it explicitly, out loud, and derive it from the
  // endpoint that actually needs the headroom (see apps/api/src/monitoring/ingest/ingest.dto.ts:
  // the per-batch ITEM caps are what bound ingest now, and they bind well before this byte cap).
  // Applies to the inflated body, so a gzipped batch is measured after decompression.
  app.useBodyParser('json', { limit: INGEST_BODY_LIMIT });

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
  } catch (error) {
    return closeAppOnBootstrapFailure(app, error);
  }
}

void bootstrap().catch((error) => {
  new NestLogger('Bootstrap').error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
