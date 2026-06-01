-- Add missing indexes on hot tables.
-- Each index corresponds to a WHERE clause or JOIN in a service file.
-- No index already present in a prior migration is repeated here.

-- ── containers ───────────────────────────────────────────────────────────────
-- WHERE supplierId used in containers.service.ts list/filter by supplier
CREATE INDEX "containers_supplierId_idx" ON "containers"("supplierId");

-- ── stock_lots ───────────────────────────────────────────────────────────────
-- WHERE containerId used when container status → arrived (lot lookup) and reports
CREATE INDEX "stock_lots_containerId_idx" ON "stock_lots"("containerId");

-- ── bag_purchases ────────────────────────────────────────────────────────────
-- WHERE date used in P&L report (bag_cost aggregation over date range)
CREATE INDEX "bag_purchases_date_idx" ON "bag_purchases"("date");
-- WHERE bagTypeId used in bag-purchases.service list-by-type queries
CREATE INDEX "bag_purchases_bagTypeId_idx" ON "bag_purchases"("bagTypeId");

-- ── packed_stocks ────────────────────────────────────────────────────────────
-- WHERE sessionId used in packing-sessions.service deleteMany on session edit
CREATE INDEX "packed_stocks_sessionId_idx" ON "packed_stocks"("sessionId");

-- ── packing_sessions ─────────────────────────────────────────────────────────
-- WHERE workerEntityId used in workers.service aggregate/groupBy for earnings
CREATE INDEX "packing_sessions_workerEntityId_idx" ON "packing_sessions"("workerEntityId");
-- WHERE orderId used when filtering sessions linked to a specific order
CREATE INDEX "packing_sessions_orderId_idx" ON "packing_sessions"("orderId");

-- ── stock_adjustments ────────────────────────────────────────────────────────
-- WHERE packedStockId used in packing-sessions.service count (edit-block guard)
CREATE INDEX "stock_adjustments_packedStockId_idx" ON "stock_adjustments"("packedStockId");
-- WHERE lotId used in stock-adjustments.service list-by-lot queries
CREATE INDEX "stock_adjustments_lotId_idx" ON "stock_adjustments"("lotId");
-- WHERE date used for date-range filtering in adjustment reports
CREATE INDEX "stock_adjustments_date_idx" ON "stock_adjustments"("date");

-- ── order_bag_lines ──────────────────────────────────────────────────────────
-- JOIN on orderId when loading order detail with bag lines (include: { orderBagLines })
CREATE INDEX "order_bag_lines_orderId_idx" ON "order_bag_lines"("orderId");

-- ── shipments ────────────────────────────────────────────────────────────────
-- WHERE orderId used in shipments.service list-by-order queries
CREATE INDEX "shipments_orderId_idx" ON "shipments"("orderId");

-- ── shipment_bags ────────────────────────────────────────────────────────────
-- JOIN on shipmentId when loading shipment with bags (include: { bags })
CREATE INDEX "shipment_bags_shipmentId_idx" ON "shipment_bags"("shipmentId");

-- ── stock_exits ──────────────────────────────────────────────────────────────
-- WHERE packedStockId used in packing-sessions.service count (edit-block guard)
--   and in reports COGS query (include: { packedStock })
CREATE INDEX "stock_exits_packedStockId_idx" ON "stock_exits"("packedStockId");
-- WHERE orderId used in stock-exits.service list-by-order queries
CREATE INDEX "stock_exits_orderId_idx" ON "stock_exits"("orderId");
-- WHERE clientId used in balance computation and reports
CREATE INDEX "stock_exits_clientId_idx" ON "stock_exits"("clientId");
-- WHERE lotId used for raw-lot exits in COGS and reports
CREATE INDEX "stock_exits_lotId_idx" ON "stock_exits"("lotId");

-- ── invoices ─────────────────────────────────────────────────────────────────
-- WHERE orderId used in invoices.service list-by-order and orders.service include
CREATE INDEX "invoices_orderId_idx" ON "invoices"("orderId");

-- ── payments ─────────────────────────────────────────────────────────────────
-- WHERE invoiceId used in payments.service list-by-invoice and invoice detail include
CREATE INDEX "payments_invoiceId_idx" ON "payments"("invoiceId");

-- ── worker_payments ──────────────────────────────────────────────────────────
-- WHERE workerId used in workers.service listPayments and earnings groupBy
CREATE INDEX "worker_payments_workerId_idx" ON "worker_payments"("workerId");
-- WHERE date used for date-range filtering in worker earnings report
CREATE INDEX "worker_payments_date_idx" ON "worker_payments"("date");
