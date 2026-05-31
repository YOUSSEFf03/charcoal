ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_kgRemaining_nonneg" CHECK ("kgRemaining" >= 0);
ALTER TABLE "packed_stocks" ADD CONSTRAINT "packed_stocks_quantity_nonneg" CHECK ("quantity" >= 0);
