import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { GlobalExceptionFilter, NodeScopeException } from './global-exception.filter';

describe('GlobalExceptionFilter', () => {
  const filter = new GlobalExceptionFilter();

  function run(exception: unknown): { status: jest.Mock; json: jest.Mock } {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
    filter.catch(exception, host);
    return res;
  }

  it('maps a body-parser error (status 400, not an HttpException) to 400 MALFORMED_REQUEST', () => {
    // Shape of an Express http-errors BadRequestError (invalid JSON / Z_DATA_ERROR bad gzip).
    const err = Object.assign(new Error('Bad Request'), { status: 400, statusCode: 400 });
    const res = run(err);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'GEN_001', message: 'MALFORMED_REQUEST' }),
      }),
    );
  });

  it('surfaces a payload-too-large body error (statusCode 413) as 413', () => {
    const res = run(Object.assign(new Error('too large'), { statusCode: 413 }));
    expect(res.status).toHaveBeenCalledWith(413);
  });

  it('still returns 500 for a generic error with no HTTP status', () => {
    const res = run(new Error('boom'));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'GEN_003' }) }),
    );
  });

  it('does NOT treat a 5xx-status error as a client error (falls through to 500)', () => {
    const res = run(Object.assign(new Error('upstream'), { status: 502 }));
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('preserves a NodeScopeException status + code', () => {
    const res = run(new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'DEVICE_001', message: 'DEVICE_NOT_FOUND' }),
      }),
    );
  });

  it('maps a bare HttpException(400) to GEN_001 VALIDATION_ERROR', () => {
    const res = run(new HttpException('bad', HttpStatus.BAD_REQUEST));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'GEN_001' }) }),
    );
  });
});
