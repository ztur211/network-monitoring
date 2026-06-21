import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { scopeCacheAls } from './scope-cache.als';

// Opens a fresh per-request scope-memo store (mirrors AuditContextMiddleware). Applied to
// all routes in AppModule; the handler then runs inside this ALS context, so
// PermissionsService.scopePropertyIds memoizes within the request.
@Injectable()
export class ScopeCacheMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction): void {
    scopeCacheAls.run(new Map(), () => next());
  }
}
