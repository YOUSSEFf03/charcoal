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
import { CreateClientLocationDto } from './dto/create-client-location.dto';
import { UpdateClientLocationDto } from './dto/update-client-location.dto';

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
   * @param dto - Client creation data
   */
  async create(dto: CreateClientDto) {
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
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) {
      throw new NotFoundException({ error: 'Client not found', code: 'NOT_FOUND' });
    }

    const phones = (client.phones as unknown as PhoneEntry[]) ?? [];
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

    const updated = [...phones, newPhone];

    return this.prisma.client.update({
      where: { id },
      data: { phones: updated as unknown as Prisma.InputJsonValue },
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
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) {
      throw new NotFoundException({ error: 'Client not found', code: 'NOT_FOUND' });
    }

    const phones = (client.phones as unknown as PhoneEntry[]) ?? [];
    const idx = phones.findIndex((p) => p.number === dto.phoneNumber);
    if (idx === -1) {
      throw new NotFoundException({
        error: 'Phone number not found',
        code: 'NOT_FOUND',
      });
    }

    phones[idx] = { ...phones[idx], isActive: false };

    return this.prisma.client.update({
      where: { id },
      data: { phones: phones as unknown as Prisma.InputJsonValue },
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
}
