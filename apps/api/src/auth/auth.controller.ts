import { All, Controller, Req, Res } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { toNodeHandler } from 'better-auth/node';
import { Request, Response } from 'express';
import { auth } from './better-auth.config';
import { Public } from './decorators/public.decorator';

// Auth routes: in production, 5 requests per 15 minutes per IP to harden against
// brute-force on sign-up/sign-in. The limit is intentionally lax in development
// because `get-session` is also covered by this controller (Better Auth's
// @All('auth/*path') handler) and the app calls it on every page load — a
// strict prod limit makes dev unusable after a few refreshes.
//
// TODO: better fix is per-endpoint throttling (strict on sign-up/sign-in,
// permissive or @SkipThrottle on get-session/sign-out) so prod also gets the
// permissive treatment on benign reads.
@Controller()
@Public()
@Throttle({
  auth: {
    limit: process.env.NODE_ENV === 'production' ? 5 : 200,
    ttl: 15 * 60 * 1000,
  },
})
@SkipThrottle({ default: true })
export class AuthController {
  @All('auth/*path')
  handleAuth(@Req() req: Request, @Res() res: Response): void {
    toNodeHandler(auth)(req, res);
  }
}
