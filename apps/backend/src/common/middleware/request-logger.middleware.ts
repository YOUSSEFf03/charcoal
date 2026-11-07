import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

/** Paths polled by monitoring — logging them would only add noise. */
const SKIP_PATHS = new Set(['/health']);

type AuthedRequest = Request & { user?: { userId?: string; role?: string } };

/**
 * One access-log line per request, written when the response finishes:
 *
 *   GET /api/v1/orders 200 34ms user=user_abc(owner) ip=100.64.0.5
 *
 * Level follows the status so the server's error alerting picks up 5xx only:
 * 5xx → error (stderr), 4xx → warn, everything else → log.
 *
 * The query string is deliberately dropped: it can carry tokens or personal
 * data, and the path alone is enough to find the failing endpoint.
 * `req.user` is read at finish time, after the auth guard has populated it.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const path = (req.originalUrl || req.url).split('?')[0];
  if (SKIP_PATHS.has(path)) {
    next();
    return;
  }

  const start = process.hrtime.bigint();
  const describe = (status: number | string) => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const user = (req as AuthedRequest).user;
    const who = user?.userId ? `${user.userId}(${user.role ?? '?'})` : '-';
    return `${req.method} ${path} ${status} ${ms.toFixed(0)}ms user=${who} ip=${req.ip ?? '-'}`;
  };

  res.on('finish', () => {
    const line = describe(res.statusCode);
    if (res.statusCode >= 500) logger.error(line);
    else if (res.statusCode >= 400) logger.warn(line);
    else logger.log(line);
  });

  // Client went away before we answered (closed tab, network drop, timeout).
  res.on('close', () => {
    if (!res.writableFinished) logger.warn(describe('ABORTED'));
  });

  next();
}
