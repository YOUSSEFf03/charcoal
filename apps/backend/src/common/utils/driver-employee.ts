import { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Every driver is also an employee: make sure a user with role 'driver' has a
 * linked Worker row (Worker.userId), so the driver shows on the Employees page
 * and can be given wages/payments like any other employee.
 *
 * This is the reverse of WorkersService.create(), which creates the linked User
 * for a new employee. It is called wherever a user can become a driver: Settings
 * "add user" (UsersService.createLocal), a role change (UsersService.updateRole)
 * and Clerk sign-up/sync (WebhooksController.upsertUser). The
 * 20261105000000_backfill_driver_employees migration covered drivers that
 * existed before this.
 *
 * Idempotent: does nothing for non-drivers, deleted users, or a user that is
 * already linked. Worker.userId is unique, so a concurrent second call fails
 * with P2002, which is swallowed: the other call already created the row.
 *
 * @returns the created Worker, or null when nothing was needed
 */
export async function ensureDriverEmployee(db: Db, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, phone: true, role: true, deletedAt: true, workerEntity: { select: { id: true } } },
  });
  if (!user || user.role !== 'driver' || user.deletedAt || user.workerEntity) return null;
  try {
    return await db.worker.create({
      data: {
        name: user.name,
        ...(user.phone ? { phone: user.phone } : {}),
        userId: user.id,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
    throw err;
  }
}
