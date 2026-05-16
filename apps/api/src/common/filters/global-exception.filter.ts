import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Response } from 'express';

export class NodeScopeException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    statusCode: number,
  ) {
    super({ code, message }, statusCode);
  }
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const timestamp = new Date().toISOString();

    if (exception instanceof ThrottlerException) {
      response.status(HttpStatus.TOO_MANY_REQUESTS).json({
        success: false,
        error: { code: 'GEN_004', message: 'RATE_LIMITED' },
        timestamp,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // Any exception that carries a { code, message } body (NodeScopeException, guard errors)
      if (typeof body === 'object' && body !== null && 'code' in body) {
        const coded = body as { code: string; message: string };
        response.status(status).json({
          success: false,
          error: { code: coded.code, message: coded.message },
          timestamp,
        });
        return;
      }

      // ValidationPipe errors — body.message is an array of constraint strings
      if (status === HttpStatus.BAD_REQUEST) {
        const validationBody = body as { message?: unknown };
        response.status(status).json({
          success: false,
          error: {
            code: 'GEN_001',
            message: 'VALIDATION_ERROR',
            details: validationBody.message,
          },
          timestamp,
        });
        return;
      }

      if (status === HttpStatus.UNAUTHORIZED) {
        response.status(status).json({
          success: false,
          error: { code: 'AUTH_002', message: 'SESSION_INVALID' },
          timestamp,
        });
        return;
      }

      if (status === HttpStatus.NOT_FOUND) {
        response.status(status).json({
          success: false,
          error: { code: 'GEN_002', message: 'NOT_FOUND' },
          timestamp,
        });
        return;
      }

      response.status(status).json({
        success: false,
        error: { code: 'GEN_003', message: 'INTERNAL_ERROR' },
        timestamp,
      });
      return;
    }

    this.logger.error({ exception }, 'Unhandled exception');
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: { code: 'GEN_003', message: 'INTERNAL_ERROR' },
      timestamp,
    });
  }
}
