import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Shared mock factory helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('OrdersService — remove()', () => {
  let service: OrdersService;

  const mockPrisma = {
    user: { findUnique: fn() },
    client: { findUnique: fn(), update: fn() },
    clientOrder: {
      findUnique: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
      findMany: fn(),
      count: fn(),
    },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  // =========================================================================
  // Test 1: order has shipments → throws ConflictException with code 'CONFLICT'
  // Note: OrdersService.remove checks status first, then shipments.
  // =========================================================================

  it('throws ConflictException with code CONFLICT when order has linked shipments (draft status)', async () => {
    const orderId = 'order-uuid-has-shipments';

    // Order is draft but HAS shipments
    mockPrisma.clientOrder.findUnique.mockResolvedValue({
      id: orderId,
      status: 'draft',
      shipments: [{ id: 'shipment-uuid-1' }],
      client: {},
      orderBagLines: [],
    });

    await expect(service.remove(orderId)).rejects.toThrow(ConflictException);

    await expect(service.remove(orderId)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONFLICT' }),
    });

    // delete must NOT be called
    expect(mockPrisma.clientOrder.delete).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Test 2: order status is NOT 'draft' → throws ConflictException
  // =========================================================================

  it('throws ConflictException with code CONFLICT when order status is not draft', async () => {
    const orderId = 'order-uuid-not-draft';

    mockPrisma.clientOrder.findUnique.mockResolvedValue({
      id: orderId,
      status: 'confirmed',
      shipments: [],
      client: {},
      orderBagLines: [],
    });

    await expect(service.remove(orderId)).rejects.toThrow(ConflictException);

    await expect(service.remove(orderId)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONFLICT' }),
    });

    expect(mockPrisma.clientOrder.delete).not.toHaveBeenCalled();
  });

  it('throws ConflictException for partially_delivered order status', async () => {
    const orderId = 'order-uuid-partial';

    mockPrisma.clientOrder.findUnique.mockResolvedValue({
      id: orderId,
      status: 'partially_delivered',
      shipments: [],
      client: {},
      orderBagLines: [],
    });

    await expect(service.remove(orderId)).rejects.toThrow(ConflictException);
  });

  it('throws ConflictException for delivered order status', async () => {
    const orderId = 'order-uuid-delivered';

    mockPrisma.clientOrder.findUnique.mockResolvedValue({
      id: orderId,
      status: 'delivered',
      shipments: [],
      client: {},
      orderBagLines: [],
    });

    await expect(service.remove(orderId)).rejects.toThrow(ConflictException);
  });

  // =========================================================================
  // Test 3: draft order with no shipments → calls clientOrder.delete
  // =========================================================================

  it('calls clientOrder.delete when order is draft with no shipments', async () => {
    const orderId = 'order-uuid-draft-clean';

    mockPrisma.clientOrder.findUnique.mockResolvedValue({
      id: orderId,
      status: 'draft',
      shipments: [],
      client: {},
      orderBagLines: [],
    });

    mockPrisma.clientOrder.delete.mockResolvedValue({ id: orderId });

    await service.remove(orderId);

    expect(mockPrisma.clientOrder.delete).toHaveBeenCalledTimes(1);
    expect(mockPrisma.clientOrder.delete).toHaveBeenCalledWith({
      where: { id: orderId },
    });
  });
});
