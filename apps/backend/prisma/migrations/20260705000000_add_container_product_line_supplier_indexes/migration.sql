-- Supplier Statement (Phase 1 — Infrastructure)
-- ContainerProductLine had zero indexes at all before this migration. The Supplier
-- Statement queries filter by supplierId alone (opening-balance scan) and by
-- supplierId + createdAt range (period scan). A single composite index serves both
-- access patterns via leftmost-prefix matching, so no separate supplierId-only
-- index is added.
CREATE INDEX "container_product_lines_supplierId_createdAt_idx" ON "container_product_lines"("supplierId", "createdAt");
