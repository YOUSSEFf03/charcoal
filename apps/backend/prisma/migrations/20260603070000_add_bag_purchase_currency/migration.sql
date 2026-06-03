-- BUG-L (P5): BagPurchase.totalCost had no currency, so P&L understated bag cost when a
-- local supplier invoiced in LBP. Add a currency column; convert LBP bag cost to USD in
-- getProfitLoss.

-- AlterTable
ALTER TABLE "bag_purchases" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'USD';

-- Backfill (documented one-time approximation): existing purchases are assumed USD — the
-- prior P&L treated them as USD and no currency was recorded. The column default stamps
-- every existing row USD; no UPDATE needed. Reclassify any genuinely-LBP historical rows
-- manually if purchasing records show otherwise.
