import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { UsersService } from './users.service';
import { WorkersService } from '../workers/workers.service';
import { ensureDriverEmployee } from '../common/utils/driver-employee';

// ---------------------------------------------------------------------------
// "Every driver is also an employee": a user with role 'driver' gets a linked
// Worker (Employees page) — on create, on role change — and the two records
// keep the same name/phone whichever side is edited.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

function makeDb() {
  const db = {
    user: { findUnique: fn(), create: fn(), update: fn() },
    worker: { findUnique: fn(), create: fn(), update: fn(), updateMany: fn() },
    workerPayment: { aggregate: fn() },
    workerCost: { aggregate: fn() },
    packingSession: { aggregate: fn() },
    $transaction: fn(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db.$transaction.mockImplementation(async (cb: any) => cb(db));
  return db;
}

const driverRow = (over: Record<string, unknown> = {}) => ({
  id: 'u-1', name: 'Sami', phone: '+961 3 000 000', role: 'driver', deletedAt: null, workerEntity: null, ...over,
});

describe('ensureDriverEmployee()', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => { db = makeDb(); });

  it('creates a Worker linked to the driver, copying name and phone', async () => {
    db.user.findUnique.mockResolvedValue(driverRow());
    db.worker.create.mockResolvedValue({ id: 'w-1' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(ensureDriverEmployee(db as any, 'u-1')).resolves.toEqual({ id: 'w-1' });
    expect(db.worker.create).toHaveBeenCalledWith({ data: { name: 'Sami', phone: '+961 3 000 000', userId: 'u-1' } });
  });

  it.each([
    ['not a driver', { role: 'accountant' }],
    ['already linked', { workerEntity: { id: 'w-9' } }],
    ['deleted', { deletedAt: new Date() }],
  ])('does nothing when the user is %s', async (_l, over) => {
    db.user.findUnique.mockResolvedValue(driverRow(over));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(ensureDriverEmployee(db as any, 'u-1')).resolves.toBeNull();
    expect(db.worker.create).not.toHaveBeenCalled();
  });

  it('treats a concurrent duplicate (P2002 on Worker.userId) as already done', async () => {
    db.user.findUnique.mockResolvedValue(driverRow());
    db.worker.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(ensureDriverEmployee(db as any, 'u-1')).resolves.toBeNull();
  });

  it('rethrows any other error', async () => {
    db.user.findUnique.mockResolvedValue(driverRow());
    db.worker.create.mockRejectedValue(new Error('boom'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(ensureDriverEmployee(db as any, 'u-1')).rejects.toThrow('boom');
  });
});

describe('UsersService — drivers become employees', () => {
  let db: ReturnType<typeof makeDb>;
  let service: UsersService;
  beforeEach(() => {
    db = makeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new UsersService(db as any);
  });

  it('createLocal(driver) creates the user and its employee in one transaction', async () => {
    db.user.create.mockResolvedValue({ id: 'u-1', role: 'driver' });
    db.user.findUnique.mockResolvedValue(driverRow());
    const user = await service.createLocal(' Sami ', 'driver', '+961 3 000 000');
    expect(user).toEqual({ id: 'u-1', role: 'driver' });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.user.create.mock.calls[0][0].data).toMatchObject({ name: 'Sami', role: 'driver' });
    expect(db.worker.create).toHaveBeenCalledWith({ data: { name: 'Sami', phone: '+961 3 000 000', userId: 'u-1' } });
  });

  it('createLocal(receiver) does not create an employee', async () => {
    db.user.create.mockResolvedValue({ id: 'u-2', role: 'receiver' });
    db.user.findUnique.mockResolvedValue(driverRow({ id: 'u-2', role: 'receiver' }));
    await service.createLocal('Rami', 'receiver');
    expect(db.worker.create).not.toHaveBeenCalled();
  });

  it('updateRole(→ driver) adds the employee record', async () => {
    db.user.findUnique
      .mockResolvedValueOnce({ id: 'u-1', clerkId: 'local_x', deletedAt: null }) // findOne
      .mockResolvedValueOnce(driverRow()); // ensureDriverEmployee
    db.user.update.mockResolvedValue({ id: 'u-1', role: 'driver' });
    await service.updateRole('u-1', 'driver');
    expect(db.worker.create).toHaveBeenCalledTimes(1);
  });

  it('updateName syncs the linked employee name and phone', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u-1', clerkId: 'local_x', deletedAt: null });
    db.user.update.mockResolvedValue({ id: 'u-1' });
    await service.updateName('u-1', ' Sami K ', ' 70 111 222 ');
    const data = { name: 'Sami K', phone: '70 111 222' };
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u-1' }, data });
    expect(db.worker.updateMany).toHaveBeenCalledWith({ where: { userId: 'u-1' }, data });
  });
});

describe('WorkersService.update — syncs the linked user', () => {
  let db: ReturnType<typeof makeDb>;
  let service: WorkersService;
  beforeEach(() => {
    db = makeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new WorkersService(db as any, {} as any);
    db.worker.findUnique.mockResolvedValue({ id: 'w-1', userId: 'u-1', name: 'Sami' });
    db.packingSession.aggregate.mockResolvedValue({ _sum: { sessionEarnings: null } });
    db.workerPayment.aggregate.mockResolvedValue({ _sum: { amount: null } });
    db.workerCost.aggregate.mockResolvedValue({ _sum: { amount: null } });
    db.worker.update.mockResolvedValue({ id: 'w-1' });
  });

  it('renaming the employee renames the linked user too', async () => {
    await service.update('w-1', { name: 'Sami K', phone: '70 111 222' });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u-1' }, data: { name: 'Sami K', phone: '70 111 222' } });
  });

  it('a notes-only edit leaves the user alone', async () => {
    await service.update('w-1', { notes: 'night shift' });
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
