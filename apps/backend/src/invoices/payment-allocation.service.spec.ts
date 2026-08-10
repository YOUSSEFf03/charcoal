import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { InternalServerErrorException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PaymentAllocationService } from './payment-allocation.service';
import { InvoiceCalculatorService } from './invoice-calculator.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}
function dec(v: string) {
  return { toString: () => v };
}

// ---------------------------------------------------------------------------
// Uses a REAL InvoiceCalculatorService instance (not mocked) so recomputeStatus
// exercises its actual PaymentAllocation-aggregate logic end-to-end against a
// hand-built tx mock — proving the whole allocate → recompute pipeline, not
// just that the right methods were called.
// ---------------------------------------------------------------------------

describe('PaymentAllocationService', () => {
  let service: PaymentAllocationService;
  let calculator: InvoiceCalculatorService;
  let tx: any;

  // In-memory PaymentAllocation table backing the mock tx, so aggregate/groupBy
  // reflect whatever allocations were actually .create()'d during the test.
  let allocationRows: { paymentId: string; invoiceId: string; amount: string }[];
  let invoicesById: Map<string, { id: string; total: string }>;

  beforeEach(() => {
    calculator = new InvoiceCalculatorService({} as any);
    service = new PaymentAllocationService(calculator);
    allocationRows = [];
    invoicesById = new Map();

    tx = {
      $queryRaw: fn().mockResolvedValue([]),
      paymentAllocation: {
        create: fn().mockImplementation(async ({ data }: any) => {
          allocationRows.push({ paymentId: data.paymentId, invoiceId: data.invoiceId, amount: data.amount });
          return { id: 'alloc-' + allocationRows.length, ...data };
        }),
        aggregate: fn().mockImplementation(async ({ where }: any) => {
          const sum = allocationRows
            .filter((r) => r.invoiceId === where.invoiceId)
            .reduce((s, r) => s.plus(r.amount), new Decimal(0));
          return { _sum: { amount: sum.gt(0) ? dec(sum.toFixed(2)) : null } };
        }),
        groupBy: fn().mockImplementation(async ({ where }: any) => {
          const ids: string[] = where.invoiceId.in;
          return ids
            .map((invoiceId) => {
              const sum = allocationRows
                .filter((r) => r.invoiceId === invoiceId)
                .reduce((s, r) => s.plus(r.amount), new Decimal(0));
              return sum.gt(0) ? { invoiceId, _sum: { amount: dec(sum.toFixed(2)) } } : null;
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
        }),
      },
      invoice: {
        findUnique: fn().mockImplementation(async ({ where }: any) => {
          const inv = invoicesById.get(where.id);
          return inv ? { total: dec(inv.total) } : null;
        }),
        update: fn(),
      },
    };
  });

  function seedInvoice(id: string, total: string) {
    invoicesById.set(id, { id, total });
  }

  // =========================================================================
  // allocateDirect — Rule 1
  // =========================================================================

  describe('allocateDirect()', () => {
    it('writes one allocation for the full amount and marks the invoice paid on exact payment', async () => {
      seedInvoice('inv-A', '240.00');

      await service.allocateDirect(tx, 'pay-1', 'inv-A', new Decimal('240.00'));

      expect(allocationRows).toEqual([{ paymentId: 'pay-1', invoiceId: 'inv-A', amount: '240.00' }]);
      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-A' },
        data: { paidAmount: '240.00', status: 'paid' },
      });
    });

    it('marks partially_paid on a partial payment', async () => {
      seedInvoice('inv-A', '240.00');

      await service.allocateDirect(tx, 'pay-1', 'inv-A', new Decimal('100.00'));

      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-A' },
        data: { paidAmount: '100.00', status: 'partially_paid' },
      });
    });

    it('locks the invoice row before writing (FOR UPDATE issued before paymentAllocation.create)', async () => {
      seedInvoice('inv-A', '240.00');
      const callOrder: string[] = [];
      tx.$queryRaw.mockImplementation(async () => { callOrder.push('lock'); return []; });
      tx.paymentAllocation.create.mockImplementation(async ({ data }: any) => {
        callOrder.push('create');
        allocationRows.push({ paymentId: data.paymentId, invoiceId: data.invoiceId, amount: data.amount });
      });

      await service.allocateDirect(tx, 'pay-1', 'inv-A', new Decimal('50.00'));

      expect(callOrder).toEqual(['lock', 'create']);
    });

    it('does not clamp to the invoice total — an overpayment is still allocated in full (matches pre-existing linked-payment behavior)', async () => {
      seedInvoice('inv-A', '240.00');

      await service.allocateDirect(tx, 'pay-1', 'inv-A', new Decimal('500.00'));

      expect(allocationRows).toEqual([{ paymentId: 'pay-1', invoiceId: 'inv-A', amount: '500.00' }]);
      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-A' },
        data: { paidAmount: '500.00', status: 'paid' },
      });
    });

    it('throws for a non-positive amount', async () => {
      await expect(service.allocateDirect(tx, 'pay-1', 'inv-A', new Decimal('0'))).rejects.toThrow(InternalServerErrorException);
    });
  });

  // =========================================================================
  // allocateFifo — Rule 2
  // =========================================================================

  describe('allocateFifo()', () => {
    it('allocates the full amount to a single open invoice', async () => {
      seedInvoice('inv-A', '240.00');
      tx.$queryRaw.mockResolvedValueOnce([{ id: 'inv-A', total: '240.00' }]);

      const result = await service.allocateFifo(tx, 'client-1', 'pay-1', new Decimal('240.00'));

      expect(allocationRows).toEqual([{ paymentId: 'pay-1', invoiceId: 'inv-A', amount: '240.00' }]);
      expect(result.unapplied).toBe('0.00');
      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-A' },
        data: { paidAmount: '240.00', status: 'paid' },
      });
    });

    it('BUG regression — Al Nakheel scenario: $240 invoice + $240 unlinked payment → paid, $0 remaining', async () => {
      seedInvoice('inv-nakheel', '240.00');
      tx.$queryRaw.mockResolvedValueOnce([{ id: 'inv-nakheel', total: '240.00' }]);

      const result = await service.allocateFifo(tx, 'client-nakheel', 'pay-nakheel', new Decimal('240.00'));

      expect(result.allocations).toEqual([{ invoiceId: 'inv-nakheel', amount: '240.00' }]);
      expect(result.unapplied).toBe('0.00');
      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-nakheel' },
        data: { paidAmount: '240.00', status: 'paid' },
      });
    });

    it('splits FIFO across multiple invoices, oldest first, exact payment amount', async () => {
      seedInvoice('inv-A', '100.00');
      seedInvoice('inv-B', '200.00');
      tx.$queryRaw.mockResolvedValueOnce([
        { id: 'inv-A', total: '100.00' },
        { id: 'inv-B', total: '200.00' },
      ]);

      const result = await service.allocateFifo(tx, 'client-1', 'pay-1', new Decimal('300.00'));

      expect(result.allocations).toEqual([
        { invoiceId: 'inv-A', amount: '100.00' },
        { invoiceId: 'inv-B', amount: '200.00' },
      ]);
      expect(result.unapplied).toBe('0.00');
      expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv-A' }, data: { paidAmount: '100.00', status: 'paid' } });
      expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv-B' }, data: { paidAmount: '200.00', status: 'paid' } });
    });

    it('partial FIFO — payment exhausted partway through the second invoice', async () => {
      seedInvoice('inv-A', '100.00');
      seedInvoice('inv-B', '200.00');
      tx.$queryRaw.mockResolvedValueOnce([
        { id: 'inv-A', total: '100.00' },
        { id: 'inv-B', total: '200.00' },
      ]);

      const result = await service.allocateFifo(tx, 'client-1', 'pay-1', new Decimal('150.00'));

      expect(result.allocations).toEqual([
        { invoiceId: 'inv-A', amount: '100.00' },
        { invoiceId: 'inv-B', amount: '50.00' },
      ]);
      expect(result.unapplied).toBe('0.00');
      expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv-A' }, data: { paidAmount: '100.00', status: 'paid' } });
      expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv-B' }, data: { paidAmount: '50.00', status: 'partially_paid' } });
    });

    it('overpayment — amount beyond all open invoices is left unapplied, no fake allocation row created', async () => {
      seedInvoice('inv-A', '100.00');
      seedInvoice('inv-B', '200.00');
      tx.$queryRaw.mockResolvedValueOnce([
        { id: 'inv-A', total: '100.00' },
        { id: 'inv-B', total: '200.00' },
      ]);

      const result = await service.allocateFifo(tx, 'client-1', 'pay-1', new Decimal('400.00'));

      expect(result.allocations).toEqual([
        { invoiceId: 'inv-A', amount: '100.00' },
        { invoiceId: 'inv-B', amount: '200.00' },
      ]);
      expect(result.unapplied).toBe('100.00');
      expect(allocationRows).toHaveLength(2); // no 3rd row for the leftover $100
      expect(tx.invoice.update).toHaveBeenCalledTimes(2); // no invoice touched for the leftover
    });

    it('no open invoices — entire amount unapplied, no allocation rows, no invoice.update calls', async () => {
      tx.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.allocateFifo(tx, 'client-1', 'pay-1', new Decimal('250.00'));

      expect(result.allocations).toEqual([]);
      expect(result.unapplied).toBe('250.00');
      expect(allocationRows).toEqual([]);
      expect(tx.invoice.update).not.toHaveBeenCalled();
    });

    it('accounts for allocations already on an invoice before this payment (partial FIFO continuation)', async () => {
      // inv-A already has $60 allocated (from an earlier payment) against a $100 total.
      seedInvoice('inv-A', '100.00');
      allocationRows.push({ paymentId: 'earlier-pay', invoiceId: 'inv-A', amount: '60.00' });
      tx.$queryRaw.mockResolvedValueOnce([{ id: 'inv-A', total: '100.00' }]);

      const result = await service.allocateFifo(tx, 'client-1', 'pay-2', new Decimal('40.00'));

      expect(result.allocations).toEqual([{ invoiceId: 'inv-A', amount: '40.00' }]);
      expect(result.unapplied).toBe('0.00');
      expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv-A' }, data: { paidAmount: '100.00', status: 'paid' } });
    });

    it('locks invoices (FOR UPDATE query) before reading already-allocated amounts', async () => {
      seedInvoice('inv-A', '100.00');
      const callOrder: string[] = [];
      tx.$queryRaw.mockImplementation(async () => { callOrder.push('lock'); return [{ id: 'inv-A', total: '100.00' }]; });
      tx.paymentAllocation.groupBy.mockImplementation(async () => { callOrder.push('read-allocated'); return []; });

      await service.allocateFifo(tx, 'client-1', 'pay-1', new Decimal('50.00'));

      expect(callOrder).toEqual(['lock', 'read-allocated']);
    });

    it('throws for a non-positive amount', async () => {
      await expect(service.allocateFifo(tx, 'client-1', 'pay-1', new Decimal('0'))).rejects.toThrow(InternalServerErrorException);
    });
  });
});
