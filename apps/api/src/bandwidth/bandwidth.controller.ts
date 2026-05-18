import { Controller, Get, Post, Req, Res, HttpCode } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { Public } from '../auth/decorators/public.decorator';

const PAYLOAD_BYTES = 1_000_000;

// Generated once at module load. Random bytes are used (not Buffer.alloc(zeros))
// so any future compression middleware can't shrink the payload on the wire and
// silently turn the bandwidth measurement into a latency measurement.
const DOWNLOAD_PAYLOAD = randomBytes(PAYLOAD_BYTES);

@Controller('bandwidth')
@Public()
@SkipThrottle()
export class BandwidthController {
  @Get('echo')
  download(@Res() res: Response): void {
    res
      .status(200)
      .set('Content-Type', 'application/octet-stream')
      .set('Content-Length', String(PAYLOAD_BYTES))
      .set('Cache-Control', 'no-store')
      .send(DOWNLOAD_PAYLOAD);
  }

  @Post('echo')
  @HttpCode(204)
  async upload(@Req() req: Request): Promise<void> {
    // Drain the request body before responding so the client's "upload time"
    // measurement reflects the actual time-to-fully-transmit, not just the
    // TCP round-trip of getting any response back.
    for await (const _chunk of req) {
      // discard
    }
  }
}
