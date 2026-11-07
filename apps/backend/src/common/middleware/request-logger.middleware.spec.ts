import { EventEmitter } from 'events';
import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { requestLogger } from './request-logger.middleware';

function run(opts: { url: string; status?: number; user?: object; finish?: boolean }) {
  const req = { method: 'GET', originalUrl: opts.url, ip: '100.64.0.5', user: opts.user } as unknown as Request;
  const res = Object.assign(new EventEmitter(), {
    statusCode: opts.status ?? 200,
    writableFinished: opts.finish !== false,
  }) as unknown as Response & EventEmitter;
  const next = jest.fn();
  requestLogger(req, res, next);
  if (opts.finish !== false) res.emit('finish');
  res.emit('close');
  return next;
}

describe('requestLogger', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('logs method, path without query, status, duration, user and ip', () => {
    const next = run({ url: '/api/v1/orders?token=secret', user: { userId: 'user_1', role: 'owner' } });
    expect(next).toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/^GET \/api\/v1\/orders 200 \d+ms user=user_1\(owner\) ip=100\.64\.0\.5$/);
    expect(log.mock.calls[0][0]).not.toContain('secret');
  });

  it('uses warn for 4xx and error for 5xx', () => {
    run({ url: '/api/v1/x', status: 404 });
    run({ url: '/api/v1/y', status: 500 });
    expect(warn.mock.calls[0][0]).toMatch(/^GET \/api\/v1\/x 404 .* user=-/);
    expect(error.mock.calls[0][0]).toMatch(/^GET \/api\/v1\/y 500 /);
    expect(log).not.toHaveBeenCalled();
  });

  it('logs aborted requests', () => {
    run({ url: '/api/v1/slow', finish: false });
    expect(warn.mock.calls[0][0]).toMatch(/^GET \/api\/v1\/slow ABORTED /);
  });

  it('skips /health', () => {
    const next = run({ url: '/health' });
    expect(next).toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
