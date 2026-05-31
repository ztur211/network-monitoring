import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { ApiError } from '@nodescope/shared';
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

    if (exception instanceof ThrottlerException) {
      this.sendError(response, HttpStatus.TOO_MANY_REQUESTS, 'GEN_004', 'RATE_LIMITED');
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // Any exception that carries a { code, message } body (NodeScopeException, guard errors)
      if (typeof body === 'object' && body !== null && 'code' in body) {
        const coded = body as { code: string; message: string };
        this.sendError(response, status, coded.code, coded.message);
        return;
      }

      // ValidationPipe errors — body.message is an array of constraint strings
      if (status === HttpStatus.BAD_REQUEST) {
        const validationBody = body as { message?: unknown };
        this.sendError(response, status, 'GEN_001', 'VALIDATION_ERROR', validationBody.message);
        return;
      }

      if (status === HttpStatus.UNAUTHORIZED) {
        this.sendError(response, status, 'AUTH_002', 'SESSION_INVALID');
        return;
      }

      if (status === HttpStatus.NOT_FOUND) {
        this.sendError(response, status, 'GEN_002', 'NOT_FOUND');
        return;
      }

      this.sendError(response, status, 'GEN_003', 'INTERNAL_ERROR');
      return;
    }

    this.logger.error({ exception }, 'Unhandled exception');
    this.sendError(response, HttpStatus.INTERNAL_SERVER_ERROR, 'GEN_003', 'INTERNAL_ERROR');
  }

  /**
   * Writes the standard error envelope. `details` is omitted from the payload
   * when undefined — matching the prior inline blocks, where an undefined
   * `details` was dropped by JSON serialization anyway.
   */
  private sendError(
    response: Response,
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ): void {
    const error = details === undefined ? { code, message } : { code, message, details };
    const payload: ApiError = {
      success: false,
      error,
      timestamp: new Date().toISOString(),
    };
    response.status(status).json(payload);
  }
}
