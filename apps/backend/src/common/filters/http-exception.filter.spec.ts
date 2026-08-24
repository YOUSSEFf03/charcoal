import { ArgumentsHost, BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function makeHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  // Regression for the bug reported as "Internal Server Error" on Mark
  // Delivered: a handler throwing `{ error, code }` with no `message` key
  // (a real, widespread pattern — e.g. ShipmentsService.drainPackedStockDirect's
  // insufficient-stock BadRequestException) must surface its own `error` text,
  // not the filter's hardcoded generic default, even though status/code are
  // already correct.
  it('falls back to `error` when the exception body has no `message` key', () => {
    const { host, status, json } = makeHost();
    const exception = new BadRequestException({
      error: 'Insufficient packed stock for bagTypeId abc — available: 0, requested: 100',
      code: 'CONSTRAINT_VIOLATION',
    });

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      error: 'Insufficient packed stock for bagTypeId abc — available: 0, requested: 100',
      code: 'CONSTRAINT_VIOLATION',
    });
  });

  it('prefers `message` over `error` when both are present', () => {
    const { host, status, json } = makeHost();
    const exception = new NotFoundException({
      message: 'Order not found',
      error: 'Order not found',
      code: 'NOT_FOUND',
    });

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith({ error: 'Order not found', code: 'NOT_FOUND' });
  });

  it('still defaults to the generic message when neither `message` nor `error` is a string', () => {
    const { host, status, json } = makeHost();
    const exception = new HttpException({ code: 'SOMETHING' }, HttpStatus.BAD_REQUEST);

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({ error: 'Internal server error', code: 'SOMETHING' });
  });

  it('maps class-validator array messages to a single "Validation failed" message regardless of `error`', () => {
    const { host, status, json } = makeHost();
    const exception = new HttpException(
      { message: ['field must not be empty'], error: 'Bad Request', statusCode: 400 },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(json).toHaveBeenCalledWith({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: { fields: ['field must not be empty'] },
    });
  });

  it('keeps the generic 500 message for a genuinely unexpected (non-HttpException) error', () => {
    const { host, status, json } = makeHost();
    filter.catch(new Error('boom'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  });
});
