import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClientBalanceService } from './client-balance.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { AddPhoneDto } from './dto/add-phone.dto';
import { DeactivatePhoneDto } from './dto/deactivate-phone.dto';
import { SetPhonesDto } from './dto/set-phones.dto';
import { SetFillBagsDto } from './dto/set-fill-bags.dto';
import { CreateClientLocationDto } from './dto/create-client-location.dto';
import { UpdateClientLocationDto } from './dto/update-client-location.dto';
import { SetOpeningBalanceDto } from '../common/dto/set-opening-balance.dto';
import { buildOpeningBalanceData, serializeOpeningBalance } from '../common/utils/opening-balance';

interface PhoneEntry {
  number: string;
  label: string;
  isActive: boolean;
  dateAdded: string;
}

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientBalanceService: ClientBalanceService,
  ) {}

  /**
   * Retrieve a paginated, optionally filtered list of clients.
   *
   * @param page - 1-indexed page number
   * @param limit - Items per page
   * @param search - Optional name substring filter (case-insensitive)
   * @param type - Optional ClientType filter
   * @param isActive - Optional active status filter
   * @param excludeFillClient - When true and type is not set, exclude fill_client type
   * @param hasBalance - When defined, filter by whether client has an outstanding balance
   * @param minTotalInvoiced - When defined, only clients with totalInvoiced >= this value
   * @param maxTotalInvoiced - When defined, only clients with totalInvoiced <= this value
   */
  async findAll(
    page: number,
    limit: number,
    search?: string,
    type?: ClientType,
    isActive?: boolean,
    excludeFillClient?: boolean,
    hasBalance?: boolean,
    sortBy?: string,
    sortOrder?: string,
    minTotalInvoiced?: number,
    maxTotalInvoiced?: number,
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.ClientWhereInput = {
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      ...(type ? { type } : excludeFillClient ? { type: { not: 'fill_client' as ClientType } } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    };

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const direction: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc';
    // 'balance'/'totalInvoiced'/'totalCollected'/'orderCount' are not stored
    // columns — they're computed per client (same as this function's existing
    // hasBalance branch below), so sorting by them needs every matching
    // client fetched and computed first, same as hasBalance already does.
    // 'name'/'lastOrderDate' are real columns, sortable directly in SQL with
    // real pagination — cheaper, so they don't force the full-fetch path.
    const computedSortKeys = ['balance', 'totalInvoiced', 'totalCollected', 'orderCount'];
    // totalInvoiced is also not a stored column (see computedSortKeys above) — a
    // min/max range on it needs the same full-fetch-then-filter path as hasBalance.
    const hasSalesRangeFilter = minTotalInvoiced !== undefined || maxTotalInvoiced !== undefined;
    const needsFullFetch = hasBalance !== undefined || hasSalesRangeFilter || (sortBy != null && computedSortKeys.includes(sortBy));

    if (needsFullFetch) {
      // Fetch all matching clients (no pagination) then filter/sort/paginate in memory.
      const allClients = await this.prisma.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      const withStats = await Promise.all(
        allClients.map(async (c) => {
          const [balance, stats] = await Promise.all([
            this.clientBalanceService.computeBalance(c.id),
            this.getInvoicedAndCollected(c.id),
          ]);
          const isOverdue = balance.gt(0) && c.lastOrderDate != null && c.lastOrderDate < thirtyDaysAgo;
          return { ...c, balance: balance.toFixed(2), isOverdue, ...stats };
        }),
      );

      const byBalance = hasBalance !== undefined
        ? withStats.filter((c) => hasBalance ? parseFloat(c.balance) > 0 : parseFloat(c.balance) <= 0)
        : withStats;

      const filtered = hasSalesRangeFilter
        ? byBalance.filter((c) => {
            const invoiced = parseFloat(c.totalInvoiced);
            if (minTotalInvoiced !== undefined && invoiced < minTotalInvoiced) return false;
            if (maxTotalInvoiced !== undefined && invoiced > maxTotalInvoiced) return false;
            return true;
          })
        : byBalance;

      if (sortBy && computedSortKeys.includes(sortBy)) {
        const key = sortBy as 'balance' | 'totalInvoiced' | 'totalCollected' | 'orderCount';
        filtered.sort((a, b) => {
          const av = key === 'orderCount' ? a.orderCount : parseFloat(a[key]);
          const bv = key === 'orderCount' ? b.orderCount : parseFloat(b[key]);
          return direction === 'asc' ? av - bv : bv - av;
        });
      }

      return {
        data: filtered.slice(skip, skip + limit),
        total: filtered.length,
        page,
        limit,
      };
    }

    const orderBy: Prisma.ClientOrderByWithRelationInput =
      sortBy === 'name' ? { name: direction } :
      sortBy === 'lastOrderDate' ? { lastOrderDate: direction } :
      sortBy === 'avgOrderDays' ? { avgOrderDays: direction } :
      { createdAt: 'desc' };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),
      this.prisma.client.count({ where }),
    ]);

    const dataWithBalance = await Promise.all(
      data.map(async (c) => {
        const [balance, stats] = await Promise.all([
          this.clientBalanceService.computeBalance(c.id),
          this.getInvoicedAndCollected(c.id),
        ]);
        const isOverdue = balance.gt(0) && c.lastOrderDate != null && c.lastOrderDate < thirtyDaysAgo;
        return { ...c, balance: balance.toFixed(2), isOverdue, ...stats };
      }),
    );

    return { data: dataWithBalance, total, page, limit };
  }

  /**
   * Total invoiced (accrual, excludes draft/cancelled — same rule as
   * ClientBalanceService.computeBalance()) and total collected (sum of all
   * payments) for one client, plus its order count. Used to surface
   * objectively-measurable "highest sales" / "most orders" client rankings
   * on the Clients list — deliberately NOT a profitability figure: it
   * carries no cost attribution (COGS/bags/delivery/labor aren't tracked
   * per-client anywhere in the schema — see the Reports P&L client-filter
   * audit), so it must never be labeled or used as "profit".
   */
  private async getInvoicedAndCollected(clientId: string) {
    const [invoicedAgg, collectedAgg, orderCount] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: { clientId, status: { notIn: ['draft', 'cancelled'] } },
        _sum: { total: true },
      }),
      this.prisma.payment.aggregate({
        where: { clientId },
        _sum: { amount: true },
      }),
      this.prisma.clientOrder.count({ where: { clientId } }),
    ]);
    return {
      totalInvoiced: (invoicedAgg._sum.total?.toString() ?? '0'),
      totalCollected: (collectedAgg._sum.amount?.toString() ?? '0'),
      orderCount,
    };
  }

  /**
   * Return tab counts for the Clients page (excludes fill_client).
   *
   * @param search - Optional name substring filter
   * @returns allCount, balanceCount, overdueCount
   */
  async getCounts(search?: string) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const where: Prisma.ClientWhereInput = {
      type: { not: 'fill_client' as ClientType },
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    };

    const clients = await this.prisma.client.findMany({ where });

    const results = await Promise.all(
      clients.map(async (c) => {
        const balance = await this.clientBalanceService.computeBalance(c.id);
        const isOverdue = balance.gt(0) && c.lastOrderDate != null && c.lastOrderDate < thirtyDaysAgo;
        return { balance, isOverdue };
      }),
    );

    const allCount = clients.length;
    const balanceCount = results.filter((r) => r.balance.gt(0)).length;
    const overdueCount = results.filter((r) => r.isOverdue).length;

    return { allCount, balanceCount, overdueCount };
  }

  /**
   * Return clients whose lastOrderDate is older than 30 days and who have
   * an outstanding balance. Sorted by most overdue first.
   */
  async findOverdue() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const clients = await this.prisma.client.findMany({
      where: {
        lastOrderDate: { lt: thirtyDaysAgo },
      },
      orderBy: { lastOrderDate: 'asc' },
    });

    const overdueClients: Array<{
      id: string;
      name: string;
      lastOrderDate: Date | null;
      avgOrderDays: any;
      balance: string;
      daysSinceLastOrder: number;
    }> = [];

    for (const client of clients) {
      const balance = await this.clientBalanceService.computeBalance(client.id);
      if (balance.gt(0)) {
        const now = new Date();
        const lastOrder = client.lastOrderDate ?? now;
        const daysSinceLastOrder = Math.floor(
          (now.getTime() - lastOrder.getTime()) / (1000 * 60 * 60 * 24),
        );
        overdueClients.push({
          ...client,
          balance: balance.toFixed(2),
          daysSinceLastOrder,
        });
      }
    }

    return overdueClients;
  }

  /**
   * Find a single client by ID and attach computed balance.
   *
   * @param id - Client UUID
   * @throws NotFoundException if client does not exist
   */
  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) {
      throw new NotFoundException({ error: 'Client not found', code: 'NOT_FOUND' });
    }

    const balance = await this.clientBalanceService.computeBalance(id);
    return { ...client, balance: balance.toFixed(2) };
  }

  /**
   * Create a new client. Each phone entry from the DTO is augmented with
   * isActive=true and a dateAdded timestamp.
   *
   * An optional opening balance is created in the same write, so a client
   * never exists without the balance the owner entered for it.
   *
   * @param dto - Client creation data
   * @param clerkUserId - Caller, recorded as setBy on the opening balance
   */
  async create(dto: CreateClientDto, clerkUserId?: string) {
    const openingBalance = dto.openingBalance
      ? await buildOpeningBalanceData(this.prisma, dto.openingBalance, clerkUserId ?? '')
      : undefined;
    return this.prisma.client.create({
      data: {
        name: dto.name,
        type: dto.type,
        currency: dto.currency,
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.notesEn !== undefined ? { notesEn: dto.notesEn } : {}),
        ...(dto.nameAr !== undefined ? { nameAr: dto.nameAr } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.creditLimit !== undefined ? { creditLimit: dto.creditLimit } : {}),
        ...(dto.paymentTerms !== undefined
          ? { paymentTerms: dto.paymentTerms }
          : {}),
        phones: (dto.phones ?? []) as Prisma.InputJsonValue,
        ...(openingBalance ? { openingBalance: { create: openingBalance } } : {}),
      },
    });
  }

  /**
   * Update an existing client (standard fields only; phones managed separately).
   *
   * @param id - Client UUID
   * @param dto - Partial update data
   * @throws NotFoundException if client does not exist
   */
  async update(id: string, dto: UpdateClientDto) {
    await this.findOne(id);

    return this.prisma.client.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.notesEn !== undefined ? { notesEn: dto.notesEn } : {}),
        ...(dto.nameAr !== undefined ? { nameAr: dto.nameAr } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.creditLimit !== undefined ? { creditLimit: dto.creditLimit } : {}),
        ...(dto.paymentTerms !== undefined ? { paymentTerms: dto.paymentTerms } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.multiLocationEnabled !== undefined ? { multiLocationEnabled: dto.multiLocationEnabled } : {}),
      },
    });
  }

  // ===========================================================================
  // Client Locations (forensic audit, 2026-08-31: "Client Multiple Locations
  // with ONE shared client balance") — provenance for normal Orders only.
  // NEVER an accounting entity: no balance, no ledger row, no AccountEntry
  // ever references a ClientLocation. See ClientLocation's schema.prisma doc
  // comment for the full read.
  // ===========================================================================

  /** GET /clients/:id/locations — every location (active + inactive), for the
   *  Client page's management UI. */
  async listLocations(clientId: string) {
    await this.findOneBare(clientId);
    return this.prisma.clientLocation.findMany({
      where: { clientId },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Create a new location — find-or-conflict, case-insensitive within this
   * client (never globally): the same "Fuel/fuel/FUEL" duplicate prevention
   * already used for ExpenseCategory, applied per-client here since names
   * are only unique within a client, not across clients.
   */
  async createLocation(clientId: string, dto: CreateClientLocationDto) {
    await this.findOneBare(clientId);
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException({ error: 'Location name is required', code: 'VALIDATION_ERROR' });
    }
    const existing = await this.prisma.clientLocation.findFirst({
      where: { clientId, name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException({
        error: `A location named "${existing.name}" already exists for this client`,
        code: 'CONFLICT',
      });
    }
    return this.prisma.clientLocation.create({
      data: {
        clientId,
        name,
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
  }

  /**
   * Update (including deactivate/reactivate) a location. There is
   * deliberately no DELETE endpoint — see ClientLocation's schema.prisma doc
   * comment: never hard-deleted once it may have orders against it, so
   * historical Statement entries (Order → ClientLocation.name) always keep
   * resolving.
   */
  async updateLocation(clientId: string, locationId: string, dto: UpdateClientLocationDto) {
    const location = await this.prisma.clientLocation.findUnique({ where: { id: locationId } });
    if (!location || location.clientId !== clientId) {
      throw new NotFoundException({ error: 'Location not found', code: 'NOT_FOUND' });
    }

    let name = location.name;
    if (dto.name !== undefined) {
      name = dto.name.trim();
      if (!name) {
        throw new BadRequestException({ error: 'Location name is required', code: 'VALIDATION_ERROR' });
      }
      if (name.toLowerCase() !== location.name.toLowerCase()) {
        const dup = await this.prisma.clientLocation.findFirst({
          where: { clientId, id: { not: locationId }, name: { equals: name, mode: 'insensitive' } },
        });
        if (dup) {
          throw new ConflictException({
            error: `A location named "${dup.name}" already exists for this client`,
            code: 'CONFLICT',
          });
        }
      }
    }

    return this.prisma.clientLocation.update({
      where: { id: locationId },
      data: {
        ...(dto.name !== undefined ? { name } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  /** Existence check only — mirrors findOne() without the balance computation,
   *  which the location endpoints have no use for. */
  /**
   * Save the Fill Clients "Edit bags & pricing" table for a client (whole
   * list, replaces the previous one). Stored on the client row so every PC
   * sees the same bags — it used to live only in one browser's localStorage.
   * `stock` is computed per page load and is never stored.
   *
   * @throws NotFoundException if client does not exist
   */
  async setFillBags(id: string, dto: SetFillBagsDto) {
    await this.findOneBare(id);
    const bags = dto.bags.map((b) => ({
      id: b.id,
      size: b.size,
      charcoal: b.charcoal.trim(),
      price: b.price,
      worker: b.worker,
      ours: b.ours,
      bagCost: b.ours ? b.bagCost : 0,
    }));
    const updated = await this.prisma.client.update({
      where: { id },
      data: { fillBags: bags as unknown as Prisma.InputJsonValue },
      select: { id: true, fillBags: true },
    });
    return updated;
  }

  private async findOneBare(id: string) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) {
      throw new NotFoundException({ error: 'Client not found', code: 'NOT_FOUND' });
    }
    return client;
  }

  /**
   * Add a phone entry to a client. Phones are stored in a JSON array.
   *
   * @param id - Client UUID
   * @param dto - Phone number and label
   * @throws NotFoundException if client does not exist
   */
  async addPhone(id: string, dto: AddPhoneDto) {
    return this.mutatePhones(id, (phones) => {
      const newPhone: PhoneEntry = {
        number: dto.number,
        label: dto.label,
        isActive: true,
        // Full timestamp, not truncated to a date-only value — matches how the
        // frontend already constructs this exact field (Clients.tsx,
        // FillClients.tsx) and avoids the server-timezone-dependent day-
        // rollback risk that .split('T')[0] alone would carry.
        dateAdded: new Date().toISOString(),
      };
      return [...phones, newPhone];
    });
  }

  /**
   * Read-modify-write of a client's phones JSON array under a row lock.
   *
   * Phones live in one JSON column, so two concurrent writers (e.g. the Edit
   * modal firing "add new number" and "deactivate old number" in parallel)
   * used to each read the same array and the last write silently dropped the
   * other's change — the "edited number sometimes doesn't save / comes back"
   * bug (2026-11-10). SELECT … FOR UPDATE serialises writers per client.
   */
  private async mutatePhones(id: string, change: (phones: PhoneEntry[]) => PhoneEntry[]) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "clients" WHERE id = ${id} FOR UPDATE`);
      const client = await tx.client.findUnique({ where: { id } });
      if (!client) {
        throw new NotFoundException({ error: 'Client not found', code: 'NOT_FOUND' });
      }
      const phones = ((client.phones as unknown as PhoneEntry[]) ?? []).map((p) => ({ ...p }));
      const updated = change(phones);
      return tx.client.update({
        where: { id },
        data: { phones: updated as unknown as Prisma.InputJsonValue },
      });
    });
  }

  /**
   * Replace a client's phone list with the one edited in the Edit modal, in a
   * single atomic write.
   *
   * CONSTRAINT 14 still holds: a stored number missing from the submitted
   * list is never deleted — it is kept, marked inactive, after the submitted
   * entries. Submitted order is preserved, so the first active entry is the
   * primary number everywhere it is displayed. Numbers are matched on their
   * digits, so "03 123 456" and "03123456" are the same number (an existing
   * entry keeps its dateAdded; label/active/spacing are updated).
   *
   * @throws BadRequestException for a number with fewer than 6 digits or a
   *   number listed twice
   */
  async setPhones(id: string, dto: SetPhonesDto) {
    const digits = (n: string) => n.replace(/\D/g, '');
    const submitted = dto.phones.map((p) => ({
      number: p.number.replace(/\s+/g, ' ').trim(),
      label: p.label.trim() || 'mobile',
      isActive: p.isActive,
    }));

    const seen = new Set<string>();
    for (const p of submitted) {
      const d = digits(p.number);
      if (d.length < 6) {
        throw new BadRequestException({
          error: `"${p.number}" is not a valid phone number`,
          code: 'CONSTRAINT_VIOLATION',
        });
      }
      if (seen.has(d)) {
        throw new BadRequestException({
          error: `${p.number} is listed twice`,
          code: 'CONSTRAINT_VIOLATION',
        });
      }
      seen.add(d);
    }

    return this.mutatePhones(id, (existing) => {
      const now = new Date().toISOString();
      const result: PhoneEntry[] = submitted.map((p) => {
        const match = existing.find((e) => digits(e.number) === digits(p.number));
        return { number: p.number, label: p.label, isActive: p.isActive, dateAdded: match?.dateAdded ?? now };
      });
      for (const e of existing) {
        if (!seen.has(digits(e.number))) result.push({ ...e, isActive: false });
      }
      return result;
    });
  }

  /**
   * Deactivate a phone entry by number.
   *
   * CONSTRAINT 14: phones are NEVER deleted — only isActive is set to false.
   *
   * @param id - Client UUID
   * @param dto - Phone number to deactivate
   * @throws NotFoundException if client or phone not found
   */
  async deactivatePhone(id: string, dto: DeactivatePhoneDto) {
    return this.mutatePhones(id, (phones) => {
      const idx = phones.findIndex((p) => p.number === dto.phoneNumber);
      if (idx === -1) {
        throw new NotFoundException({
          error: 'Phone number not found',
          code: 'NOT_FOUND',
        });
      }
      phones[idx] = { ...phones[idx], isActive: false };
      return phones;
    });
  }

  /**
   * Paginated orders for a client.
   */
  async getOrders(clientId: string, page: number, limit: number) {
    await this.findOne(clientId);

    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.clientOrder.findMany({
        where: { clientId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { orderBagLines: true },
      }),
      this.prisma.clientOrder.count({ where: { clientId } }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Paginated invoices for a client.
   */
  async getInvoices(clientId: string, page: number, limit: number) {
    await this.findOne(clientId);

    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where: { clientId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.invoice.count({ where: { clientId } }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Paginated payments for a client.
   */
  async getPayments(clientId: string, page: number, limit: number) {
    await this.findOne(clientId);

    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where: { clientId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.payment.count({ where: { clientId } }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Return the computed balance for a client.
   *
   * CONSTRAINT 15: never reads a stored balance column.
   */
  async getBalance(clientId: string) {
    const client = await this.findOne(clientId);
    const balance = await this.clientBalanceService.computeBalance(clientId);
    return { balance: balance.toFixed(2), currency: client.currency };
  }

  // ── Opening balance (go-live carry-forward) ──────────────────────────────
  // One per client, in the client's own currency, signed. See the
  // ClientOpeningBalance model doc comment for why this is not an Invoice.

  /** The client's opening balance, or null if none was entered. */
  async getOpeningBalance(clientId: string) {
    await this.findOneBare(clientId);
    const row = await this.prisma.clientOpeningBalance.findUnique({
      where: { clientId },
      include: { setBy: { select: { name: true } } },
    });
    return serializeOpeningBalance(row);
  }

  /** Create or replace the client's opening balance. */
  async setOpeningBalance(clientId: string, dto: SetOpeningBalanceDto, clerkUserId: string) {
    await this.findOneBare(clientId);
    const data = await buildOpeningBalanceData(this.prisma, dto, clerkUserId);
    const row = await this.prisma.clientOpeningBalance.upsert({
      where: { clientId },
      create: { clientId, ...data },
      update: data,
      include: { setBy: { select: { name: true } } },
    });
    return serializeOpeningBalance(row);
  }

  /** Remove the client's opening balance (no-op if there is none). */
  async clearOpeningBalance(clientId: string): Promise<void> {
    await this.findOneBare(clientId);
    await this.prisma.clientOpeningBalance.deleteMany({ where: { clientId } });
  }
}
