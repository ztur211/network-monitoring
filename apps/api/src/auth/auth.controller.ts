import { All, Controller, Req, Res } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { toNodeHandler } from 'better-auth/node';
import { Request, Response } from 'express';
import { auth } from './better-auth.config';
import { Public } from './decorators/public.decorator';

// Strict per-IP limiter for credential endpoints (sign-in / sign-up / reset):
// 5 requests / 15 minutes in production to slow brute-force guessing. Lax in
// development so refreshes don't lock you out.
const STRICT_AUTH_THROTTLE = {
  auth: {
    limit: process.env.NODE_ENV === 'production' ? 5 : 200,
    ttl: 15 * 60 * 1000,
  },
};

@Controller()
@Public()
export class AuthController {
  // get-session is a benign read with nothing to brute-force, yet the SPA calls
  // it on every navigation (and twice on cold start). Keeping it under the
  // strict `auth` limiter meant ~5 page loads in 15 minutes could 429 a real
  // user in production. Skip the `auth` bucket here so it falls back to the
  // lenient global `default` limiter (100/min). Declared before the wildcard so
  // Express matches this exact path first.
  @All('auth/get-session')
  @SkipThrottle({ auth: true })
  handleGetSession(@Req() req: Request, @Res() res: Response): void {
    toNodeHandler(auth)(req, res);
  }

  // Everything else under /api/auth/* (sign-up, sign-in, reset-password, …) gets
  // the strict auth limiter; `default` is skipped so these aren't double-counted.
  @All('auth/*path')
  @Throttle(STRICT_AUTH_THROTTLE)
  @SkipThrottle({ default: true })
  handleAuth(@Req() req: Request, @Res() res: Response): void {
    toNodeHandler(auth)(req, res);
  }
}
