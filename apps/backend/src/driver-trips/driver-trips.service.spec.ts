import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { DriverTripsService } from './driver-trips.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClerkUser } from '../auth/clerk.strategy';

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

describe('DriverTripsService', () => {
  let service: DriverTripsService;

  const mockPrisma = {
    user: { findUnique: fn() },
    driverTrip: {
      findUnique: fn(),
      findMany: fn(),
      create: fn(),
      update: fn(),
      count: fn(),
    },
    shipment: { updateMany: fn() },
    $transaction: fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DriverTripsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DriverTripsService>(DriverTripsService);
  });

  // =========================================================================
  // findOne()
  // =========================================================================

  describe('findOne()', () => {

    // =========================================================================
    // Test 1: driver accesses their own trip → returns trip
    // =========================================================================

    it('returns trip when caller is a driver and trip.driverId matches user.id', async () => {
      const tripId = 'trip-uuid-1';
      const driverClerkId = 'clerk-driver-1';
      const driverDbId = 'db-driver-id-1';

      const trip = {
        id: tripId,
        driverId: driverDbId,
        driver: { id: driverDbId, name: 'Alice' },
        shipments: [],
      };

      mockPrisma.driverTrip.findUnique.mockResolvedValue(trip);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: driverDbId,
        clerkId: driverClerkId,
      });

      const currentUser: ClerkUser = { userId: driverClerkId, role: 'driver' };
      const result = await service.findOne(tripId, currentUser);

      expect(result).toBe(trip);
    });

    // =========================================================================
    // Test 2: driver accesses another driver's trip → throws ForbiddenException
    // =========================================================================

    it('throws ForbiddenException with code FORBIDDEN when driver tries to access another driver\'s trip', async () => {
      const tripId = 'trip-uuid-2';
      const callerClerkId = 'clerk-driver-caller';
      const callerDbId = 'db-driver-caller-id';
      const ownerDbId = 'db-driver-owner-id';

      // Trip belongs to a different driver
      mockPrisma.driverTrip.findUnique.mockResolvedValue({
        id: tripId,
        driverId: ownerDbId,
        driver: { id: ownerDbId, name: 'Bob' },
        shipments: [],
      });

      // Resolve caller's internal user
      mockPrisma.user.findUnique.mockResolvedValue({
        id: callerDbId,
        clerkId: callerClerkId,
      });

      const currentUser: ClerkUser = { userId: callerClerkId, role: 'driver' };

      await expect(
        service.findOne(tripId, currentUser),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.findOne(tripId, currentUser),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'FORBIDDEN' }),
      });
    });

    // =========================================================================
    // Additional: non-driver role can access any trip without restriction
    // =========================================================================

    it('returns trip for a non-driver role without ownership check', async () => {
      const tripId = 'trip-uuid-3';

      const trip = {
        id: tripId,
        driverId: 'some-driver-id',
        driver: { id: 'some-driver-id', name: 'Charlie' },
        shipments: [],
      };

      mockPrisma.driverTrip.findUnique.mockResolvedValue(trip);
      // user.findUnique should NOT be called for non-driver roles

      const currentUser: ClerkUser = { userId: 'clerk-owner-1', role: 'owner' };
      const result = await service.findOne(tripId, currentUser);

      expect(result).toBe(trip);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // findAll()
  // =========================================================================

  describe('findAll()', () => {

    // =========================================================================
    // Test 3: driver role → resolves own userId and sets it as driverId filter
    // =========================================================================

    it('driver role: resolves internal userId from clerkId and sets it as driverId in the where clause', async () => {
      const driverClerkId = 'clerk-driver-findall';
      const driverDbId = 'db-driver-findall-id';

      mockPrisma.user.findUnique.mockResolvedValue({
        id: driverDbId,
        clerkId: driverClerkId,
      });

      // $transaction receives an array of promises → return [data, count]
      mockPrisma.$transaction.mockResolvedValue([[], 0]);

      const currentUser: ClerkUser = { userId: driverClerkId, role: 'driver' };
      await service.findAll(1, 20, currentUser);

      // user.findUnique must be called with the driver's clerkId to resolve internal id
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { clerkId: driverClerkId },
      });

      // The $transaction must have been called (with an array, since it's a [findMany, count] call)
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      const transactionArg = mockPrisma.$transaction.mock.calls[0][0];
      expect(transactionArg).toBeInstanceOf(Array);
    });

    // =========================================================================
    // Additional: non-driver role passes driverId param through without user lookup
    // =========================================================================

    it('non-driver role: does not call user.findUnique and passes driverId param directly', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);

      const currentUser: ClerkUser = { userId: 'clerk-owner-2', role: 'owner' };
      await service.findAll(1, 20, currentUser, 'some-driver-uuid');

      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
