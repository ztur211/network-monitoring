import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../auth/better-auth.config';
import { Public } from '../auth/decorators/public.decorator';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { DesktopAuthService } from './desktop-auth.service';
import { ExchangeCodeDto } from './desktop-auth.dto';

const ALLOWED_REDIRECT_URI = 'nodescope://auth/callback';

@Controller('v1/desktop-auth')
export class DesktopAuthController {
  constructor(private readonly service: DesktopAuthService) {}

  /**
   * Step 1 of the system-browser PKCE flow.
   * @Public — no session required to start the flow.
   * If the user has a valid session, issue a one-time code and redirect back to the
   * desktop app. If not, redirect to the web login with a returnTo param so the user
   * is brought back here after authenticating.
   */
  @Get('authorize')
  @Public()
  async authorize(
    @Query('code_challenge') challenge: string,
    @Query('state') state: string,
    @Query('redirect_uri') redirectUri: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (redirectUri !== ALLOWED_REDIRECT_URI) {
      throw new NodeScopeException('DAUTH_001', 'INVALID_REDIRECT_URI', HttpStatus.BAD_REQUEST);
    }

    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) {
      const apiBase = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
      const back = encodeURIComponent(`${apiBase}${req.originalUrl}`);
      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:8081';
      return res.redirect(`${frontendUrl}/login?returnTo=${back}`);
    }

    const code = await this.service.issueCode({ sessionToken: session.session.token, challenge });
    return res.redirect(
      `${ALLOWED_REDIRECT_URI}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    );
  }

  /**
   * Step 2 of the PKCE flow — exchange the one-time code + verifier for a bearer token.
   * @Public — no session required; the code itself is the credential.
   * Returns 201 (POST creating a resource — the token).
   */
  @Post('token')
  @Public()
  async token(@Body() dto: ExchangeCodeDto) {
    const token = await this.service.exchange(dto.code, dto.code_verifier);
    return { success: true, data: { token }, timestamp: new Date().toISOString() };
  }

  /**
   * Revoke the desktop session.
   * NOT @Public — the global AuthGuard validates the Bearer token before this runs,
   * ensuring only the holder of a valid token can revoke it.
   */
  @Post('revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Req() req: Request) {
    await auth.api.signOut({ headers: fromNodeHeaders(req.headers) });
  }
}
