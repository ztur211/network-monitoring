import { All, Controller, Req, Res } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { toNodeHandler } from 'better-auth/node';
import { Request, Response } from 'express';
import { auth } from './better-auth.config';
import { Public } from './decorators/public.decorator';

// Auth routes: 5 requests per 15 minutes per IP (covers sign-up and sign-in).
// The default 100/min throttle is skipped — auth routes use the 'auth' throttle only.
@Controller()
@Public()
@Throttle({ auth: { limit: 5, ttl: 15 * 60 * 1000 } })
@SkipThrottle({ default: true })
export class AuthController {
  @All('auth/*path')
  handleAuth(@Req() req: Request, @Res() res: Response): void {
    toNodeHandler(auth)(req, res);
  }
}
