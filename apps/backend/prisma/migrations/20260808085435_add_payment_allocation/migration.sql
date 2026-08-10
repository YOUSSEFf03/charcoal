-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id"),
    -- Single-row invariant only — Postgres CHECK constraints cannot reference
    -- other rows, so "SUM(amount) per payment <= Payment.amount" and
    -- "SUM(amount) per invoice <= Invoice.total" are enforced transactionally
    -- in PaymentAllocationService (which holds a row lock on the invoice for
    -- the duration of the read-then-write) instead. See that service's
    -- doc comment for why a trigger-based constraint wasn't used.
    CONSTRAINT "payment_allocations_amount_positive" CHECK ("amount" > 0)
);

-- CreateIndex
CREATE INDEX "payment_allocations_paymentId_idx" ON "payment_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "payment_allocations_invoiceId_idx" ON "payment_allocations"("invoiceId");

-- AddForeignKey
-- RESTRICT: a Payment or Invoice that has an allocation can never be deleted
-- out from under it. In practice this never fires — invoices.service.ts's
-- remove() only permits deleting invoices in 'draft' status, and draft
-- invoices are never payment-eligible (payments.service.ts requires
-- issued/partially_paid) so a draft invoice can never have allocations;
-- payments have no delete endpoint at all. RESTRICT documents the invariant
-- explicitly rather than relying on those call sites never changing.
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
