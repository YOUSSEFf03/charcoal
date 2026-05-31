-- CreateEnum
CREATE TYPE "AccountEntryType" AS ENUM ('payment_received', 'sale_collected', 'handover');

-- CreateTable: one account per user (denormalized running balance)
CREATE TABLE "user_accounts" (
    "id"        TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    "balance"   DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_accounts_userId_key" ON "user_accounts"("userId");
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: ledger — every credit and debit
CREATE TABLE "account_entries" (
    "id"          TEXT                  NOT NULL,
    "accountId"   TEXT                  NOT NULL,
    "amount"      DECIMAL(10,2)         NOT NULL,
    "type"        "AccountEntryType"    NOT NULL,
    "referenceId" TEXT,
    "description" TEXT,
    "date"        DATE                  NOT NULL,
    "createdAt"   TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "account_entries_accountId_idx"   ON "account_entries"("accountId");
CREATE INDEX "account_entries_referenceId_idx" ON "account_entries"("referenceId");
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "user_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── DATA MIGRATION ──────────────────────────────────────────────────────────
-- Seed accounts for everyone who has collected money (FK-based or string-based).

-- FK-based: users referenced via receiverId on payments
INSERT INTO "user_accounts" ("id", "userId", "balance", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u.id, 0, NOW(), NOW()
FROM "users" u
WHERE u.id IN (
    SELECT DISTINCT "receiverId"  FROM "payments"    WHERE "receiverId"   IS NOT NULL
    UNION
    SELECT DISTINCT "collectedById" FROM "stock_exits" WHERE "collectedById" IS NOT NULL
)
ON CONFLICT ("userId") DO NOTHING;

-- String-based: match receiverName / collectedBy to users by name
INSERT INTO "user_accounts" ("id", "userId", "balance", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u.id, 0, NOW(), NOW()
FROM "users" u
WHERE u.name IN (
    SELECT DISTINCT "receiverName" FROM "payments"    WHERE "receiverId"   IS NULL AND "receiverName" IS NOT NULL
    UNION
    SELECT DISTINCT "collectedBy"  FROM "stock_exits" WHERE "collectedById" IS NULL AND "collectedBy"  IS NOT NULL
)
ON CONFLICT ("userId") DO NOTHING;

-- ── Seed account entries ─────────────────────────────────────────────────────

-- Credits: FK-based payments
INSERT INTO "account_entries" ("id","accountId","amount","type","referenceId","description","date","createdAt")
SELECT gen_random_uuid()::text, ua.id, p.amount, 'payment_received', p.id,
       'Payment — ' || c.name, p.date, p."createdAt"
FROM "payments" p
JOIN "user_accounts" ua ON ua."userId" = p."receiverId"
JOIN "clients" c ON c.id = p."clientId"
WHERE p."receiverId" IS NOT NULL;

-- Credits: string-based payments
INSERT INTO "account_entries" ("id","accountId","amount","type","referenceId","description","date","createdAt")
SELECT gen_random_uuid()::text, ua.id, p.amount, 'payment_received', p.id,
       'Payment — ' || c.name, p.date, p."createdAt"
FROM "payments" p
JOIN "users" u ON u.name = p."receiverName"
JOIN "user_accounts" ua ON ua."userId" = u.id
JOIN "clients" c ON c.id = p."clientId"
WHERE p."receiverId" IS NULL AND p."receiverName" IS NOT NULL;

-- Credits: FK-based exits
INSERT INTO "account_entries" ("id","accountId","amount","type","referenceId","description","date","createdAt")
SELECT gen_random_uuid()::text, ua.id, e.amount, 'sale_collected', e.id,
       'Warehouse sale', e.date, e."createdAt"
FROM "stock_exits" e
JOIN "user_accounts" ua ON ua."userId" = e."collectedById"
WHERE e."collectedById" IS NOT NULL AND e.amount IS NOT NULL;

-- Credits: string-based exits
INSERT INTO "account_entries" ("id","accountId","amount","type","referenceId","description","date","createdAt")
SELECT gen_random_uuid()::text, ua.id, e.amount, 'sale_collected', e.id,
       'Warehouse sale', e.date, e."createdAt"
FROM "stock_exits" e
JOIN "users" u ON u.name = e."collectedBy"
JOIN "user_accounts" ua ON ua."userId" = u.id
WHERE e."collectedById" IS NULL AND e."collectedBy" IS NOT NULL AND e.amount IS NOT NULL;

-- Debits: FK-based handovers (negative amount)
INSERT INTO "account_entries" ("id","accountId","amount","type","referenceId","description","date","createdAt")
SELECT gen_random_uuid()::text, ua.id, -h."handedAmt", 'handover', h.id,
       'Cash handover', h.date, h."createdAt"
FROM "cash_handovers" h
JOIN "user_accounts" ua ON ua."userId" = h."receiverId"
WHERE h."receiverId" IS NOT NULL;

-- Debits: string-based handovers
INSERT INTO "account_entries" ("id","accountId","amount","type","referenceId","description","date","createdAt")
SELECT gen_random_uuid()::text, ua.id, -h."handedAmt", 'handover', h.id,
       'Cash handover', h.date, h."createdAt"
FROM "cash_handovers" h
JOIN "users" u ON u.name = h."receiverName"
JOIN "user_accounts" ua ON ua."userId" = u.id
WHERE h."receiverId" IS NULL;

-- ── Compute initial balances from seeded entries ─────────────────────────────
UPDATE "user_accounts" ua
SET "balance"   = COALESCE((SELECT SUM(ae.amount) FROM "account_entries" ae WHERE ae."accountId" = ua.id), 0),
    "updatedAt" = NOW();
