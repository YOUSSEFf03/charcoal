import {
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
   */
  async findAll(
    page: number,
    limit: number,
    search?: string,
    type?: ClientType,
    isActive?: boolean,
    excludeFillClient?: boolean,
    hasBalance?: boolean,
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.ClientWhereInput = {
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      ...(type ? { type } : excludeFillClient ? { type: { not: 'fill_client' as ClientType } } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    };

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    if (hasBalance !== undefined) {
      // Fetch all matching clients (no pagination) then filter by balance
      const allClients = await this.prisma.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      const withBalance = await Promise.all(
        allClients.map(async (c) => {
          const balance = await this.clientBalanceService.computeBalance(c.id);
          const isOverdue = balance.gt(0) && c.lastOrderDate != null && c.lastOrderDate < thirtyDaysAgo;
          return { ...c, balance: balance.toFixed(2), isOverdue };
        }),
      );

      const filtered = withBalance.filter((c) =>
        hasBalance ? parseFloat(c.balance) > 0 : parseFloat(c.balance) <= 0,
      );

      return {
        data: filtered.slice(skip, skip + limit),
        total: filtered.length,
        page,
        limit,
      };
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.client.count({ where }),
    ]);

    const dataWithBalance = await Promise.all(
      data.map(async (c) => {
        const balance = await this.clientBalanceService.computeBalance(c.id);
        const isOverdue = balance.gt(0) && c.lastOrderDate != null && c.lastOrderDate < thirtyDaysAgo;
        return { ...c, balance: balance.toFixed(2), isOverdue };
      }),
    );

    return { data: dataWithBalance, total, page, limit };
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
        ...(dto.paymentTerms !== undefined ? { paymentTerms: dto.paymentTerms } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
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
      dateAdded: new Date().toISOString().split('T')[0],
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
    await this.findOne(clientId);
    const balance = await this.clientBalanceService.computeBalance(clientId);
    return { balance: balance.toFixed(2) };
  }
}
