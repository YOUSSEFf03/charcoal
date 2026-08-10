import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import Decimal from 'decimal.js';
import { NotFoundException } from '@nestjs/common';
import { LedgerWriteService } from './ledger-write.service';

// ---------------------------------------------------------------------------
// PR 1 — these tests prove LedgerWriteService.creditAccount()/debitAccount()
// behave identically to the original creditAccount()/debitAccount() functions
// that used to live inline in CashHandoversService. No new behavior is
// introduced here; every assertion mirrors what the original implementation
// did (see git history of cash-handovers.service.ts prior to this PR).
//
// PR 6 — creditAccount() now validates the holder via UsersService.validateCashCapable()
// before writing anything. mockUsersService defaults to "always valid" so all the
// PR 1 tests below remain unaffected; the dedicated "holder validation" describe
// block covers the new rejection behavior.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

describe('LedgerWriteService', () => {
  let service: LedgerWriteService;
  let tx: any;
  let mockUsersService: { validateCashCapable: any };

  beforeEach(() => {
    mockUsersService = { validateCashCapable: fn() };
    mockUsersService.validateCashCapable.mockResolvedValue(undefined);
    service = new LedgerWriteService(mockUsersService as any);
    tx = {
      userAccount: { upsert: fn() },
      accountEntry: { create: fn() },
    };
  });

  // =========================================================================
  // creditAccount()
  // =========================================================================

  describe('creditAccount()', () => {
    it('upserts the UserAccount, creating it with the credited balance when none exists yet', async () => {
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1', userId: 'user-1', balance: 50 });

      await service.creditAccount(
        tx, 'user-1', new Decimal('50.00'), 'payment_received', 'payment-1', 'Payment — Client A', new Date('2026-07-31'),
      );

      expect(tx.userAccount.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        update: { balance: { increment: 50 } },
        create: { userId: 'user-1', balance: 50 },
      });
    });

    it('increments an existing balance rather than overwriting it', async () => {
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1', userId: 'user-1', balance: 150 });

      await service.creditAccount(
        tx, 'user-1', new Decimal('100.00'), 'sale_collected', 'exit-1', 'Warehouse sale', new Date('2026-07-31'),
      );

      const call = tx.userAccount.upsert.mock.calls[0][0];
      expect(call.update).toEqual({ balance: { increment: 100 } });
    });

    it('writes an AccountEntry with the positive amount, correct type, and linking to the account the upsert returned', async () => {
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-42', userId: 'user-1', balance: 25 });
      const date = new Date('2026-07-31');

      await service.creditAccount(
        tx, 'user-1', new Decimal('25.00'), 'payment_received', 'payment-99', 'Payment — Marina Walk Café', date,
      );

      expect(tx.accountEntry.create).toHaveBeenCalledWith({
        data: {
          accountId: 'account-42',
          amount: '25.00',
          type: 'payment_received',
          referenceId: 'payment-99',
          description: 'Payment — Marina Walk Café',
          date,
        },
      });
    });

    it('accepts both payment_received and sale_collected types, passed through unchanged', async () => {
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });

      await service.creditAccount(tx, 'user-1', new Decimal('10'), 'sale_collected', 'exit-1', 'desc', new Date());
      expect(tx.accountEntry.create.mock.calls[0][0].data.type).toBe('sale_collected');

      await service.creditAccount(tx, 'user-1', new Decimal('10'), 'payment_received', 'payment-1', 'desc', new Date());
      expect(tx.accountEntry.create.mock.calls[1][0].data.type).toBe('payment_received');
    });

    it('formats the ledger entry amount to 2 decimal places via Decimal.toFixed(2)', async () => {
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });

      await service.creditAccount(tx, 'user-1', new Decimal('19.996'), 'payment_received', 'payment-1', 'desc', new Date());

      expect(tx.accountEntry.create.mock.calls[0][0].data.amount).toBe('20.00');
    });

    it('passes the numeric (not Decimal) amount to Prisma for the balance increment, matching the original .toNumber() call', async () => {
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });

      await service.creditAccount(tx, 'user-1', new Decimal('12.5'), 'payment_received', 'payment-1', 'desc', new Date());

      const call = tx.userAccount.upsert.mock.calls[0][0];
      expect(typeof call.update.balance.increment).toBe('number');
      expect(call.update.balance.increment).toBe(12.5);
    });

    it('operates only on the transaction client passed by the caller (composable inside any $transaction)', async () => {
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });

      await service.creditAccount(tx, 'user-1', new Decimal('10'), 'payment_received', 'ref-1', 'desc', new Date());

      expect(tx.userAccount.upsert).toHaveBeenCalledTimes(1);
      expect(tx.accountEntry.create).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // debitAccount()
  // =========================================================================

  describe('debitAccount()', () => {
    it('upserts the UserAccount, creating it with a negative balance when none exists yet', async () => {
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1', userId: 'user-1', balance: -30 });

      await service.debitAccount(tx, 'user-1', new Decimal('30.00'), 'handover-1', new Date('2026-07-31'));

      expect(tx.userAccount.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        update: { balance: { decrement: 30 } },
        create: { userId: 'user-1', balance: -30 },
      });
    });

    it('decrements an existing balance', async () => {
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1', userId: 'user-1', balance: 0 });

      await service.debitAccount(tx, 'user-1', new Decimal('25.00'), 'handover-2', new Date('2026-07-31'));

      const call = tx.userAccount.upsert.mock.calls[0][0];
      expect(call.update).toEqual({ balance: { decrement: 25 } });
    });

    it('writes an AccountEntry with the negated amount, type=handover, and the fixed "Cash handover" description', async () => {
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-7' });
      const date = new Date('2026-07-31');

      await service.debitAccount(tx, 'user-1', new Decimal('25.00'), 'handover-3', date);

      expect(tx.accountEntry.create).toHaveBeenCalledWith({
        data: {
          accountId: 'account-7',
          amount: '-25.00',
          type: 'handover',
          referenceId: 'handover-3',
          description: 'Cash handover',
          date,
        },
      });
    });

    it('formats the negated ledger entry amount to 2 decimal places', async () => {
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });

      await service.debitAccount(tx, 'user-1', new Decimal('19.996'), 'handover-4', new Date());

      expect(tx.accountEntry.create.mock.calls[0][0].data.amount).toBe('-20.00');
    });

    it('does not floor the balance at zero — a handover larger than the current balance is allowed to go negative, matching original behavior', async () => {
      // The original implementation never guarded against this; this test documents
      // that PR 1 did not introduce (or remove) any such guard.
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1', balance: -75 });

      await service.debitAccount(tx, 'user-1', new Decimal('100.00'), 'handover-5', new Date());

      expect(tx.userAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { balance: { decrement: 100 } } }),
      );
    });

    it('operates only on the transaction client passed by the caller (composable inside any $transaction)', async () => {
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });

      await service.debitAccount(tx, 'user-1', new Decimal('10'), 'handover-6', new Date());

      expect(tx.userAccount.upsert).toHaveBeenCalledTimes(1);
      expect(tx.accountEntry.create).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // PR 6 — server-side holder validation inside creditAccount()
  // =========================================================================

  describe('creditAccount() — holder validation (PR 6)', () => {
    it('validates the holder via UsersService.validateCashCapable before writing anything', async () => {
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });

      await service.creditAccount(tx, 'user-1', new Decimal('10'), 'payment_received', 'ref-1', 'desc', new Date());

      expect(mockUsersService.validateCashCapable).toHaveBeenCalledWith('user-1');
    });

    it('rejects with the holder-validation error and writes nothing when the holder is invalid', async () => {
      mockUsersService.validateCashCapable.mockRejectedValue(
        new NotFoundException({ error: 'Receiver not found', code: 'NOT_FOUND' }),
      );

      await expect(
        service.creditAccount(tx, 'nonexistent-user', new Decimal('10'), 'payment_received', 'ref-1', 'desc', new Date()),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(tx.userAccount.upsert).not.toHaveBeenCalled();
      expect(tx.accountEntry.create).not.toHaveBeenCalled();
    });

    it('does not add any holder validation to debitAccount() — out of scope for PR 6', async () => {
      tx.userAccount.upsert.mockResolvedValue({ id: 'account-1' });

      await service.debitAccount(tx, 'user-1', new Decimal('10'), 'handover-1', new Date());

      expect(mockUsersService.validateCashCapable).not.toHaveBeenCalled();
    });
  });
});
