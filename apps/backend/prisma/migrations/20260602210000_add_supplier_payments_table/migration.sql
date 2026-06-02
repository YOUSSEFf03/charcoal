CREATE TABLE "supplier_payments" (
  "id"           TEXT            NOT NULL,
  "supplier_id"  TEXT            NOT NULL,
  "container_id" TEXT,
  "amount"       DECIMAL(12,2)   NOT NULL,
  "currency"     "Currency"      NOT NULL DEFAULT 'USD',
  "method"       "PaymentMethod" NOT NULL DEFAULT 'bank_transfer',
  "date"         DATE            NOT NULL,
  "notes"        TEXT,
  "logged_by_id" TEXT            NOT NULL,
  "created_at"   TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_container_id_fkey"
  FOREIGN KEY ("container_id") REFERENCES "containers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_logged_by_id_fkey"
  FOREIGN KEY ("logged_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "supplier_payments_supplier_id_idx" ON "supplier_payments"("supplier_id");
CREATE INDEX "supplier_payments_date_idx"        ON "supplier_payments"("date");
