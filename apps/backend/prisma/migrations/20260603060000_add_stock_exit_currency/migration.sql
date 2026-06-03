-- BUG-K (P5): StockExit.amount had no currency, so P&L valued legacy anonymous LBP cash
-- sales as USD. Add a currency column; convert LBP exits to USD in getProfitLoss.

-- AlterTable
ALTER TABLE "stock_exits" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'USD';

-- Backfill (documented one-time approximation): existing amount-bearing exits are assumed
-- USD — no evidence of currency was recorded, and historically the P&L treated them as USD.
-- The column default already stamps every existing row USD; no UPDATE needed. Invoice-linked
-- walk-in exits carry amount=null and are excluded from the P&L walk-in aggregate regardless.
