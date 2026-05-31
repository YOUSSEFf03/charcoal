// ─────────────────────────────────────────────────────────────────────────────
// MSW (Mock Service Worker) Request Handlers
// Install: npm install msw --save-dev
// Setup:   npx msw init public/ --save
// Usage:   import { worker } from "./mocks/browser" then worker.start()
// ─────────────────────────────────────────────────────────────────────────────

import { http, HttpResponse } from "msw";
import { db } from "./db";

const BASE = "/api/v1";

// ── Health ────────────────────────────────────────────────────────────────────

const healthHandlers = [
  http.get(`${BASE}/health`, () => {
    return HttpResponse.json({ status: "ok", database: "connected (mock)" });
  }),
];

// ── Suppliers ─────────────────────────────────────────────────────────────────

const supplierHandlers = [
  http.get(`${BASE}/suppliers`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const search = url.searchParams.get("search")?.toLowerCase();

    let list = db.suppliers;
    if (search) list = list.filter((s) => s.name.toLowerCase().includes(search));

    return HttpResponse.json(db.paginate(list, page, limit));
  }),

  http.get(`${BASE}/suppliers/:id`, ({ params }) => {
    const item = db.findById(db.suppliers, params.id as string);
    if (!item) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    return HttpResponse.json(item);
  }),

  http.post(`${BASE}/suppliers`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const newItem = { id: `supplier-${Date.now()}`, ...body, contactPersons: body.contactPersons ?? [], charcoalTypes: body.charcoalTypes ?? [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.suppliers.push(newItem as typeof db.suppliers[0]);
    return HttpResponse.json(newItem, { status: 201 });
  }),

  http.patch(`${BASE}/suppliers/:id`, async ({ params, request }) => {
    const idx = db.suppliers.findIndex((s) => s.id === params.id);
    if (idx === -1) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    const body = await request.json() as Record<string, unknown>;
    db.suppliers[idx] = { ...db.suppliers[idx], ...body, updatedAt: new Date().toISOString() };
    return HttpResponse.json(db.suppliers[idx]);
  }),

  http.delete(`${BASE}/suppliers/:id`, ({ params }) => {
    const idx = db.suppliers.findIndex((s) => s.id === params.id);
    if (idx === -1) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    db.suppliers.splice(idx, 1);
    return new HttpResponse(null, { status: 204 });
  }),
];

// ── Containers ────────────────────────────────────────────────────────────────

const containerHandlers = [
  http.get(`${BASE}/containers`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const status = url.searchParams.get("status");

    let list = db.containers;
    if (status) list = list.filter((c) => c.status === status);

    const enriched = list.map((c) => ({
      ...c,
      supplier: db.findById(db.suppliers, c.supplierId),
    }));

    return HttpResponse.json(db.paginate(enriched, page, limit));
  }),

  http.get(`${BASE}/containers/:id`, ({ params }) => {
    const container = db.findById(db.containers, params.id as string);
    if (!container) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });

    return HttpResponse.json({
      ...container,
      supplier: db.findById(db.suppliers, container.supplierId),
      productLines: db.containerProductLines.filter((l) => l.containerId === params.id),
      expenses: db.containerExpenses.filter((e) => e.containerId === params.id),
      discount: db.containerDiscounts.find((d) => d.containerId === params.id) ?? null,
    });
  }),

  http.post(`${BASE}/containers`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const newItem = { id: `container-${Date.now()}`, status: "port", createdById: "user-owner-001", ...body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.containers.push(newItem as typeof db.containers[0]);
    return HttpResponse.json(newItem, { status: 201 });
  }),

  http.patch(`${BASE}/containers/:id`, async ({ params, request }) => {
    const idx = db.containers.findIndex((c) => c.id === params.id);
    if (idx === -1) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    const body = await request.json() as Record<string, unknown>;
    db.containers[idx] = { ...db.containers[idx], ...body, updatedAt: new Date().toISOString() };
    return HttpResponse.json(db.containers[idx]);
  }),

  http.get(`${BASE}/containers/:id/expenses`, ({ params }) => {
    return HttpResponse.json(db.containerExpenses.filter((e) => e.containerId === params.id));
  }),

  http.post(`${BASE}/containers/:id/expenses`, async ({ params, request }) => {
    const body = await request.json() as Record<string, unknown>;
    const expense = { id: `exp-${Date.now()}`, containerId: params.id as string, addedById: "user-owner-001", addedAt: new Date().toISOString(), ...body };
    db.containerExpenses.push(expense as typeof db.containerExpenses[0]);
    return HttpResponse.json(expense, { status: 201 });
  }),

  http.get(`${BASE}/containers/:id/product-lines`, ({ params }) => {
    return HttpResponse.json(db.containerProductLines.filter((l) => l.containerId === params.id));
  }),

  http.get(`${BASE}/containers/:id/discount`, ({ params }) => {
    const discount = db.containerDiscounts.find((d) => d.containerId === params.id);
    return HttpResponse.json(discount ?? null);
  }),

  http.get(`${BASE}/containers/:id/stock-lots`, ({ params }) => {
    return HttpResponse.json(db.stockLots.filter((l) => l.containerId === params.id));
  }),
];

// ── Warehouse ─────────────────────────────────────────────────────────────────

const warehouseHandlers = [
  http.get(`${BASE}/warehouse/summary`, () => {
    const totalRawKg = db.stockLots.reduce((sum, l) => sum + parseFloat(l.kgRemaining), 0);
    const packedSummary = db.bagTypes.map((bt) => {
      const total = db.packedStocks
        .filter((ps) => ps.bagTypeId === bt.id)
        .reduce((sum, ps) => sum + ps.quantity, 0);
      return {
        bagTypeId: bt.id,
        bagTypeName: bt.name,
        nominalKg: bt.nominalKg,
        totalQuantity: total,
        totalNominalKg: (total * parseFloat(bt.nominalKg)).toFixed(3),
      };
    });
    const totalPackedNominalKg = packedSummary.reduce((sum, p) => sum + parseFloat(p.totalNominalKg), 0);

    return HttpResponse.json({
      totalRawKg: totalRawKg.toFixed(3),
      totalPackedNominalKg: totalPackedNominalKg.toFixed(3),
      totalSystemKg: (totalRawKg + totalPackedNominalKg).toFixed(3),
      lotCount: db.stockLots.filter((l) => parseFloat(l.kgRemaining) > 0).length,
      packedSummary,
    });
  }),

  http.get(`${BASE}/stock-lots`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    return HttpResponse.json(db.paginate(db.stockLots, page, limit));
  }),

  http.get(`${BASE}/stock-lots/:id`, ({ params }) => {
    const item = db.findById(db.stockLots, params.id as string);
    if (!item) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    return HttpResponse.json({ ...item, supplier: db.findById(db.suppliers, item.supplierId) });
  }),

  http.get(`${BASE}/bag-types`, () => {
    return HttpResponse.json(db.bagTypes);
  }),

  http.get(`${BASE}/bag-types/:id`, ({ params }) => {
    const item = db.findById(db.bagTypes, params.id as string);
    if (!item) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    return HttpResponse.json(item);
  }),

  http.post(`${BASE}/bag-types`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const item = { id: `bagtype-${Date.now()}`, ...body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.bagTypes.push(item as typeof db.bagTypes[0]);
    return HttpResponse.json(item, { status: 201 });
  }),

  http.get(`${BASE}/packed-stock`, () => {
    return HttpResponse.json(db.packedStocks.map((ps) => ({
      ...ps,
      bagType: db.findById(db.bagTypes, ps.bagTypeId),
      lot: db.findById(db.stockLots, ps.lotId),
    })));
  }),

  http.get(`${BASE}/packed-stock/summary`, () => {
    const summary = db.bagTypes.map((bt) => {
      const total = db.packedStocks.filter((ps) => ps.bagTypeId === bt.id).reduce((s, ps) => s + ps.quantity, 0);
      return {
        bagTypeId: bt.id,
        bagTypeName: bt.name,
        nominalKg: bt.nominalKg,
        totalQuantity: total,
        totalNominalKg: (total * parseFloat(bt.nominalKg)).toFixed(3),
      };
    });
    return HttpResponse.json(summary);
  }),

  http.get(`${BASE}/packing-sessions`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    return HttpResponse.json(db.paginate(db.packingSessions, page, limit));
  }),

  http.get(`${BASE}/packing-sessions/:id`, ({ params }) => {
    const item = db.findById(db.packingSessions, params.id as string);
    if (!item) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    return HttpResponse.json(item);
  }),

  http.post(`${BASE}/packing-sessions`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const item = { id: `session-${Date.now()}`, ...body, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
    db.packingSessions.push(item as typeof db.packingSessions[0]);
    return HttpResponse.json(item, { status: 201 });
  }),

  http.get(`${BASE}/workers`, () => HttpResponse.json(db.workers)),

  http.get(`${BASE}/workers/:id`, ({ params }) => {
    const item = db.findById(db.workers, params.id as string);
    if (!item) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    return HttpResponse.json(item);
  }),

  http.get(`${BASE}/workers/:id/payments`, ({ params }) => {
    return HttpResponse.json(db.workerPayments.filter((p) => p.workerId === params.id));
  }),
];

// ── Clients ───────────────────────────────────────────────────────────────────

const clientHandlers = [
  http.get(`${BASE}/clients`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const search = url.searchParams.get("search")?.toLowerCase();
    const type = url.searchParams.get("type");

    let list = db.clients;
    if (search) list = list.filter((c) => c.name.toLowerCase().includes(search));
    if (type) list = list.filter((c) => c.type === type);

    return HttpResponse.json(db.paginate(list, page, limit));
  }),

  http.get(`${BASE}/clients/overdue`, () => {
    const today = new Date();
    const overdue = db.clients
      .filter((c) => c.lastOrderDate && c.avgOrderDays)
      .map((c) => {
        const lastOrder = new Date(c.lastOrderDate!);
        const daysSince = Math.floor((today.getTime() - lastOrder.getTime()) / (1000 * 60 * 60 * 24));
        const avg = parseFloat(c.avgOrderDays!);
        return {
          clientId: c.id,
          clientName: c.name,
          clientType: c.type,
          lastOrderDate: c.lastOrderDate,
          daysSinceLastOrder: daysSince,
          avgOrderDays: c.avgOrderDays,
          daysOverdue: Math.max(0, daysSince - avg),
          balance: c.balance ?? "0.00",
          currency: c.currency,
        };
      })
      .filter((c) => c.daysOverdue > 0)
      .sort((a, b) => b.daysOverdue - a.daysOverdue);

    return HttpResponse.json(overdue);
  }),

  http.get(`${BASE}/clients/:id`, ({ params }) => {
    const item = db.findById(db.clients, params.id as string);
    if (!item) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    return HttpResponse.json(item);
  }),

  http.post(`${BASE}/clients`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const item = { id: `client-${Date.now()}`, phones: [], preferredTypes: [], balance: "0.00", ...body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.clients.push(item as typeof db.clients[0]);
    return HttpResponse.json(item, { status: 201 });
  }),

  http.patch(`${BASE}/clients/:id`, async ({ params, request }) => {
    const idx = db.clients.findIndex((c) => c.id === params.id);
    if (idx === -1) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    const body = await request.json() as Record<string, unknown>;
    db.clients[idx] = { ...db.clients[idx], ...body, updatedAt: new Date().toISOString() };
    return HttpResponse.json(db.clients[idx]);
  }),

  http.get(`${BASE}/clients/:id/balance`, ({ params }) => {
    const client = db.findById(db.clients, params.id as string);
    if (!client) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    return HttpResponse.json({ balance: client.balance ?? "0.00", currency: client.currency });
  }),

  http.get(`${BASE}/clients/:id/orders`, ({ params, request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const list = db.orders.filter((o) => o.clientId === params.id);
    return HttpResponse.json(db.paginate(list, page, limit));
  }),

  http.get(`${BASE}/clients/:id/invoices`, ({ params, request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const list = db.invoices.filter((i) => i.clientId === params.id);
    return HttpResponse.json(db.paginate(list, page, limit));
  }),

  http.get(`${BASE}/clients/:id/payments`, ({ params, request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const list = db.payments.filter((p) => p.clientId === params.id);
    return HttpResponse.json(db.paginate(list, page, limit));
  }),
];

// ── Orders ────────────────────────────────────────────────────────────────────

const orderHandlers = [
  http.get(`${BASE}/orders`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const status = url.searchParams.get("status");
    const clientId = url.searchParams.get("clientId");

    let list = db.orders;
    if (status) list = list.filter((o) => o.status === status);
    if (clientId) list = list.filter((o) => o.clientId === clientId);

    return HttpResponse.json(db.paginate(list, page, limit));
  }),

  http.get(`${BASE}/orders/:id`, ({ params }) => {
    const item = db.findById(db.orders, params.id as string);
    if (!item) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    return HttpResponse.json({
      ...item,
      client: db.findById(db.clients, item.clientId),
      shipments: db.shipments.filter((s) => s.orderId === params.id),
    });
  }),

  http.post(`${BASE}/orders`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const item = { id: `order-${Date.now()}`, status: "draft", createdById: "user-sales-001", ...body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.orders.push(item as typeof db.orders[0]);
    return HttpResponse.json(item, { status: 201 });
  }),

  http.patch(`${BASE}/orders/:id`, async ({ params, request }) => {
    const idx = db.orders.findIndex((o) => o.id === params.id);
    if (idx === -1) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    const body = await request.json() as Record<string, unknown>;
    db.orders[idx] = { ...db.orders[idx], ...body, updatedAt: new Date().toISOString() };
    return HttpResponse.json(db.orders[idx]);
  }),
];

// ── Invoices ──────────────────────────────────────────────────────────────────

const invoiceHandlers = [
  http.get(`${BASE}/invoices`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    return HttpResponse.json(db.paginate(db.invoices, page, limit));
  }),

  http.get(`${BASE}/invoices/:id`, ({ params }) => {
    const item = db.findById(db.invoices, params.id as string);
    if (!item) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    return HttpResponse.json({ ...item, client: db.findById(db.clients, item.clientId), payments: db.payments.filter((p) => p.invoiceId === params.id) });
  }),

  http.post(`${BASE}/invoices`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const lines = (body.lines as Array<{ bagTypeName?: string; qty: number; pricePerBag: string }>) ?? [];
    const subtotal = lines.reduce((s, l) => s + l.qty * parseFloat(l.pricePerBag), 0).toFixed(2);
    const item = { id: `invoice-${Date.now()}`, status: "draft", paidAmount: "0.00", subtotal, total: subtotal, ...body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.invoices.push(item as typeof db.invoices[0]);
    return HttpResponse.json(item, { status: 201 });
  }),

  http.post(`${BASE}/invoices/:id/issue`, ({ params }) => {
    const idx = db.invoices.findIndex((i) => i.id === params.id);
    if (idx === -1) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    db.invoices[idx] = { ...db.invoices[idx], status: "issued" as typeof db.invoices[0]["status"], issuedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    return HttpResponse.json(db.invoices[idx]);
  }),
];

// ── Payments ──────────────────────────────────────────────────────────────────

const paymentHandlers = [
  http.get(`${BASE}/payments`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    return HttpResponse.json(db.paginate(db.payments, page, limit));
  }),

  http.get(`${BASE}/payments/:id`, ({ params }) => {
    const item = db.findById(db.payments, params.id as string);
    if (!item) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    return HttpResponse.json(item);
  }),

  http.post(`${BASE}/payments`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const item = { id: `payment-${Date.now()}`, loggedById: "user-sales-001", ...body, createdAt: new Date().toISOString() };
    db.payments.push(item as typeof db.payments[0]);
    return HttpResponse.json(item, { status: 201 });
  }),
];

// ── Delivery ──────────────────────────────────────────────────────────────────

const deliveryHandlers = [
  http.get(`${BASE}/shipments`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    return HttpResponse.json(db.paginate(db.shipments, page, limit));
  }),

  http.get(`${BASE}/shipments/:id`, ({ params }) => {
    const item = db.findById(db.shipments, params.id as string);
    if (!item) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    return HttpResponse.json(item);
  }),

  http.get(`${BASE}/shipments/:id/receipt`, ({ params }) => {
    const shipment = db.findById(db.shipments, params.id as string);
    if (!shipment) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    const order = db.findById(db.orders, shipment.orderId);
    const client = order ? db.findById(db.clients, order.clientId) : undefined;

    return HttpResponse.json({
      receiptId: `REC-${shipment.id.slice(-6).toUpperCase()}`,
      companyName: "Charcoal Imports Lebanon",
      date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString(),
      clientName: client?.name ?? "Walk-in",
      address: shipment.address,
      lines: shipment.bags.map((b) => {
        const bt = db.findById(db.bagTypes, b.bagTypeId);
        return {
          bagTypeName: bt?.name ?? "Unknown",
          quantity: b.quantity,
          pricePerBag: order?.pricePerBag ?? "0.00",
          lineTotal: (b.quantity * parseFloat(order?.pricePerBag ?? "0")).toFixed(2),
        };
      }),
      subtotal: "170.00",
      currency: order?.currency ?? "USD",
      paymentStatus: "on_account",
      driverName: "Khalil Mansour",
    });
  }),

  http.post(`${BASE}/shipments/:id/confirm-delivery`, async ({ params }) => {
    const idx = db.shipments.findIndex((s) => s.id === params.id);
    if (idx === -1) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    db.shipments[idx] = { ...db.shipments[idx], status: "delivered" as typeof db.shipments[0]["status"], deliveredAt: new Date().toISOString() };
    return HttpResponse.json(db.shipments[idx]);
  }),

  http.get(`${BASE}/driver-trips`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    return HttpResponse.json(db.paginate(db.driverTrips, page, limit));
  }),

  http.get(`${BASE}/driver-trips/:id`, ({ params }) => {
    const item = db.findById(db.driverTrips, params.id as string);
    if (!item) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    return HttpResponse.json({ ...item, shipments: db.shipments.filter((s) => s.tripId === params.id) });
  }),

  http.post(`${BASE}/driver-trips`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const item = { id: `trip-${Date.now()}`, status: "planned", otherExpenses: [], ...body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.driverTrips.push(item as typeof db.driverTrips[0]);
    return HttpResponse.json(item, { status: 201 });
  }),

  http.get(`${BASE}/stock-exits`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    return HttpResponse.json(db.paginate(db.stockExits, page, limit));
  }),
];

// ── Reports ───────────────────────────────────────────────────────────────────

const reportHandlers = [
  http.get(`${BASE}/reports/profit-loss`, () => {
    return HttpResponse.json({
      revenue: "560.00",
      cogs: "74.34",
      bagCost: "5.20",
      varianceCost: "52.72",
      deliveryCost: "18.00",
      grossProfit: "409.74",
      filters: {},
      generatedAt: new Date().toISOString(),
    });
  }),

  http.get(`${BASE}/reports/stock-value`, () => {
    return HttpResponse.json({
      rawStockValue: "1834.94",
      packedStockValue: "220.28",
      totalWarehouseValue: "2055.22",
      lots: db.stockLots.map((l) => ({
        lotId: l.id,
        charcoalType: l.charcoalType,
        grade: l.grade,
        supplierName: db.findById(db.suppliers, l.supplierId)?.name ?? "",
        kgRemaining: l.kgRemaining,
        costPerKg: l.costPerKg,
        value: (parseFloat(l.kgRemaining) * parseFloat(l.costPerKg)).toFixed(2),
      })),
      packedBreakdown: [],
      generatedAt: new Date().toISOString(),
    });
  }),

  http.get(`${BASE}/reports/variance`, () => {
    return HttpResponse.json({
      sessions: db.packingSessions.map((s) => ({
        sessionId: s.id,
        date: s.date,
        workerName: "Hassan Nassar",
        lotId: s.lotId,
        charcoalType: "BBQ hardwood",
        grade: "A",
        kgConsumed: s.kgConsumed,
        kgOutput: s.kgOutputTotal,
        varianceKg: s.varianceKg,
        variancePercent: ((parseFloat(s.varianceKg) / parseFloat(s.kgConsumed)) * 100).toFixed(2) + "%",
      })),
      byCharcoalType: [{ charcoalType: "BBQ hardwood", grade: "A", totalVarianceKg: "-140.000", totalVarianceCost: "52.00" }],
      byWorker: [{ workerId: "worker-001", workerName: "Hassan Nassar", totalVarianceKg: "-140.000" }],
      filters: {},
      generatedAt: new Date().toISOString(),
    });
  }),

  http.get(`${BASE}/reports/client-ledger/:clientId`, ({ params }) => {
    const client = db.findById(db.clients, params.clientId as string);
    if (!client) return HttpResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    const clientInvoices = db.invoices.filter((i) => i.clientId === params.clientId);
    const clientPayments = db.payments.filter((p) => p.clientId === params.clientId);
    return HttpResponse.json({
      clientId: client.id,
      clientName: client.name,
      currency: client.currency,
      invoices: clientInvoices.map((i) => ({ invoiceId: i.id, date: i.issuedAt ?? i.createdAt, amount: i.total, currency: i.currency, status: i.status })),
      payments: clientPayments.map((p) => ({ paymentId: p.id, date: p.date, amount: p.amount, method: p.method })),
      totalInvoiced: clientInvoices.reduce((s, i) => s + parseFloat(i.total), 0).toFixed(2),
      totalPaid: clientPayments.reduce((s, p) => s + parseFloat(p.amount), 0).toFixed(2),
      balance: client.balance ?? "0.00",
      generatedAt: new Date().toISOString(),
    });
  }),

  http.get(`${BASE}/reports/physical-count`, () => {
    const items = [
      ...db.stockLots.map((l) => ({ type: "lot" as const, id: l.id, name: `${l.charcoalType} Grade ${l.grade}`, systemQty: l.kgRemaining })),
      ...db.packedStocks.map((ps) => ({ type: "packed_stock" as const, id: ps.id, name: db.findById(db.bagTypes, ps.bagTypeId)?.name ?? ps.bagTypeId, systemQty: String(ps.quantity) })),
    ];
    return HttpResponse.json(items);
  }),
];

// ─── Export all handlers ──────────────────────────────────────────────────────

export const handlers = [
  ...healthHandlers,
  ...supplierHandlers,
  ...containerHandlers,
  ...warehouseHandlers,
  ...clientHandlers,
  ...orderHandlers,
  ...invoiceHandlers,
  ...paymentHandlers,
  ...deliveryHandlers,
  ...reportHandlers,
];

// ─── Browser worker setup ─────────────────────────────────────────────────────
// Create src/mocks/browser.ts with:
//
// import { setupWorker } from "msw/browser";
// import { handlers } from "../../backend-docs/mocks/handlers";
// export const worker = setupWorker(...handlers);
//
// In main.tsx (development only):
// if (import.meta.env.DEV && import.meta.env.VITE_USE_MOCK_API === "true") {
//   const { worker } = await import("./mocks/browser");
//   await worker.start({ onUnhandledRequest: "bypass" });
// }
