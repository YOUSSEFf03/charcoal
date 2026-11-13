import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RolesGuard } from '../auth/roles.guard';
import { WhatsAppShareService, maskPhone, SHARE_TTL_MS } from './whatsapp-share.service';
import { WhatsAppShareController } from './whatsapp-share.controller';
import { validateWhatsAppPhone } from './whatsapp-phone';
import { PrepareWhatsAppShareDto } from './dto/prepare-whatsapp-share.dto';
import { ReportWhatsAppShareOutcomeDto } from './dto/report-whatsapp-share-outcome.dto';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const OTHER_CLIENT = '22222222-2222-4222-8222-222222222222';
const INVOICE = '33333333-3333-4333-8333-333333333333';
const ORDER = '44444444-4444-4444-8444-444444444444';
const SUPPLIER = '55555555-5555-4555-8555-555555555555';

const owner = { userId: 'user-owner', role: 'owner' };
const sales = { userId: 'user-sales', role: 'sales_rep' };

function makePrisma() {
  return {
    invoice: { findUnique: jest.fn() },
    clientOrder: { findUnique: jest.fn() },
    client: { findUnique: jest.fn() },
    supplier: { findUnique: jest.fn() },
  };
}

describe('validateWhatsAppPhone', () => {
  it.each([
    ['+961 70 123 456', '96170123456'],
    ['70123456', '96170123456'],
    ['03 454 385', '9613454385'],
    ['+961 03454385', '9613454385'],
    ['+33 6 12 34 56 78', '33612345678'],
    ['(+961) 71-960-117', '96171960117'],
  ])('accepts %s → %s', (raw, digits) => {
    expect(validateWhatsAppPhone(raw)).toEqual({ ok: true, digits });
  });

  it.each([
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['call me', 'BAD_CHARACTERS'],
    ['70123456; DROP', 'BAD_CHARACTERS'],
    ['123', 'BAD_LENGTH'],
    ['+961 70 123 456 789', 'BAD_LENGTH'],
    ['+1234567890123456', 'BAD_LENGTH'],
  ])('rejects %j (%s)', (raw, reason) => {
    expect(validateWhatsAppPhone(raw)).toEqual({ ok: false, reason });
  });
});

describe('WhatsAppShareService.prepare — document authorization', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: WhatsAppShareService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new WhatsAppShareService(prisma as any);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  });

  const dto = (over: Partial<PrepareWhatsAppShareDto> = {}): PrepareWhatsAppShareDto => ({
    documentType: 'invoice',
    documentId: INVOICE,
    customerId: CLIENT,
    phoneNumber: '+961 70 123 456',
    ...over,
  });

  it('prepares an invoice that belongs to the customer and flags a saved number', async () => {
    prisma.invoice.findUnique.mockResolvedValue({ clientId: CLIENT, client: { phones: [{ number: '70 123 456' }] } });
    const res = await service.prepare(dto(), owner);
    expect(res.phoneDigits).toBe('96170123456');
    expect(res.phoneMatchesSaved).toBe(true);
    expect(res.shareId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(res.expiresAt).getTime() - new Date(res.preparedAt).getTime()).toBe(SHARE_TTL_MS);
  });

  it('accepts a typed number that is not saved, but reports phoneMatchesSaved=false', async () => {
    prisma.invoice.findUnique.mockResolvedValue({ clientId: CLIENT, client: { phones: [{ number: '03 111 222' }] } });
    const res = await service.prepare(dto(), owner);
    expect(res.phoneMatchesSaved).toBe(false);
  });

  it('rejects an invoice that belongs to ANOTHER customer (404, no data leak)', async () => {
    prisma.invoice.findUnique.mockResolvedValue({ clientId: OTHER_CLIENT, client: { phones: [] } });
    await expect(service.prepare(dto(), owner)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a missing invoice', async () => {
    prisma.invoice.findUnique.mockResolvedValue(null);
    await expect(service.prepare(dto(), owner)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('checks delivery receipts against the order\'s client', async () => {
    prisma.clientOrder.findUnique.mockResolvedValue({ clientId: OTHER_CLIENT, client: { phones: [] } });
    await expect(service.prepare(dto({ documentType: 'delivery_receipt', documentId: ORDER }), owner))
      .rejects.toBeInstanceOf(NotFoundException);
    prisma.clientOrder.findUnique.mockResolvedValue({ clientId: CLIENT, client: { phones: [] } });
    await expect(service.prepare(dto({ documentType: 'delivery_receipt', documentId: ORDER }), owner))
      .resolves.toMatchObject({ phoneDigits: '96170123456' });
  });

  it('a client statement must be for the same client id', async () => {
    prisma.client.findUnique.mockResolvedValue({ phones: [] });
    await expect(service.prepare(dto({ documentType: 'client_statement', documentId: OTHER_CLIENT }), owner))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.prepare(dto({ documentType: 'client_statement', documentId: CLIENT }), owner))
      .resolves.toBeDefined();
  });

  it('supplier statements are owner/accountant only (sales_rep → 403)', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ contactPersons: [{ name: 'Omar', phone: '70123456' }] });
    const d = dto({ documentType: 'supplier_statement', documentId: SUPPLIER, customerId: SUPPLIER });
    await expect(service.prepare(d, sales)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.prepare(d, owner)).resolves.toMatchObject({ phoneMatchesSaved: true });
    expect(prisma.supplier.findUnique).toHaveBeenCalledTimes(1);
  });

  it('rejects roles that cannot read documents (driver/worker) and unauthenticated calls', async () => {
    await expect(service.prepare(dto(), { userId: 'd', role: 'driver' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.prepare(dto(), undefined)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an invalid phone before touching the database', async () => {
    await expect(service.prepare(dto({ phoneNumber: '12' }), owner)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
  });

  it('logs "prepared … not sent" with a masked phone number', async () => {
    prisma.invoice.findUnique.mockResolvedValue({ clientId: CLIENT, client: { phones: [] } });
    const log = (service as any).logger.log as jest.Mock;
    await service.prepare(dto(), owner);
    const line = log.mock.calls[0][0] as string;
    expect(line).toContain('prepared');
    expect(line).toContain('not sent');
    expect(line).not.toContain('96170123456');
    expect(line).toContain('********456');
    expect(line).not.toMatch(/\bsent=true|message sent/i);
  });
});

describe('WhatsAppShareService.reportOutcome', () => {
  let service: WhatsAppShareService;
  let shareId: string;

  beforeEach(async () => {
    const prisma = makePrisma();
    prisma.invoice.findUnique.mockResolvedValue({ clientId: CLIENT, client: { phones: [] } });
    service = new WhatsAppShareService(prisma as any);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    shareId = (await service.prepare({ documentType: 'invoice', documentId: INVOICE, customerId: CLIENT, phoneNumber: '70123456' }, owner)).shareId;
  });

  it('records the outcome once, for the same user only', () => {
    expect(() => service.reportOutcome(shareId, { outcome: 'ready_for_manual_send' }, sales)).toThrow(ForbiddenException);
    service.reportOutcome(shareId, { outcome: 'ready_for_manual_send' }, owner);
    expect(() => service.reportOutcome(shareId, { outcome: 'failed' }, owner)).toThrow(NotFoundException);
  });

  it('rejects unknown and expired shares', () => {
    expect(() => service.reportOutcome('99999999-9999-4999-8999-999999999999', { outcome: 'failed' }, owner)).toThrow(NotFoundException);
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + SHARE_TTL_MS + 1);
    expect(() => service.reportOutcome(shareId, { outcome: 'failed' }, owner)).toThrow(NotFoundException);
    jest.restoreAllMocks();
  });
});

describe('DTO validation', () => {
  it('rejects unknown document types and non-UUID ids', async () => {
    const bad = plainToInstance(PrepareWhatsAppShareDto, { documentType: 'payroll', documentId: 'x', customerId: CLIENT, phoneNumber: '70123456' });
    const errors = await validate(bad);
    expect(errors.map((e) => e.property).sort()).toEqual(['documentId', 'documentType']);
  });

  it('the outcome DTO has no "sent" outcome', async () => {
    const bad = plainToInstance(ReportWhatsAppShareOutcomeDto, { outcome: 'sent' });
    expect((await validate(bad)).map((e) => e.property)).toEqual(['outcome']);
  });
});

describe('WhatsAppShareController — role enforcement', () => {
  const guard = new RolesGuard(new Reflector());
  const ctx = (role: string, handler: 'prepare' | 'reportOutcome') => ({
    switchToHttp: () => ({ getRequest: () => ({ user: { role, userId: 'u' } }) }),
    getHandler: () => (WhatsAppShareController.prototype as any)[handler],
    getClass: () => WhatsAppShareController,
  }) as any;

  it.each(['driver', 'worker'])('%s cannot prepare or report shares', (role) => {
    expect(() => guard.canActivate(ctx(role, 'prepare'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx(role, 'reportOutcome'))).toThrow(ForbiddenException);
  });

  it.each(['owner', 'accountant', 'sales_rep'])('%s may prepare shares', (role) => {
    expect(guard.canActivate(ctx(role, 'prepare'))).toBe(true);
  });
});

describe('maskPhone', () => {
  it('keeps only the last three digits', () => {
    expect(maskPhone('96171960117')).toBe('********117');
    expect(maskPhone('12')).toBe('***');
  });
});
