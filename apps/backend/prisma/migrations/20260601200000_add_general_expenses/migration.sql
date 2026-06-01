-- Migration: 20260601200000_add_general_expenses
-- Adds general_expenses table for operator-managed recurring and one-time
-- business expenses (rent, utilities, equipment, etc.).

CREATE TABLE "general_expenses" (
    "id"          TEXT            NOT NULL,
    "description" TEXT            NOT NULL,
    "amount"      DECIMAL(10,2)   NOT NULL,
    "isRecurring" BOOLEAN         NOT NULL DEFAULT false,
    "category"    TEXT,
    "date"        DATE            NOT NULL DEFAULT CURRENT_DATE,
    "notes"       TEXT,
    "addedById"   TEXT            NOT NULL,
    "createdAt"   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT "general_expenses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "general_expenses_addedById_fkey"
        FOREIGN KEY ("addedById") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "general_expenses_date_idx"        ON "general_expenses"("date");
CREATE INDEX "general_expenses_isRecurring_idx" ON "general_expenses"("isRecurring");
