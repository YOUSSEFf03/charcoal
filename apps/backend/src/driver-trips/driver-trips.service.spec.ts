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

  // =========================================================================
  // startTrip() / completeTrip() — IDOR regression: a driver must not be able
  // to start/complete another driver's trip. Both endpoints are
  // @Roles('driver', 'owner'), so without this check any authenticated
  // driver could hit POST /driver-trips/:id/start or /complete for a trip
  // assigned to someone else.
  // =========================================================================

  describe('startTrip() — ownership guard', () => {
    it('throws ForbiddenException(FORBIDDEN) when a driver starts another driver\'s trip, and never updates it', async () => {
      const tripId = 'trip-uuid-4';
      const callerClerkId = 'clerk-driver-caller-2';
      const callerDbId = 'db-driver-caller-id-2';
      const ownerDbId = 'db-driver-owner-id-2';

      mockPrisma.driverTrip.findUnique.mockResolvedValue({ id: tripId, driverId: ownerDbId, status: 'pending' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: callerDbId, clerkId: callerClerkId, role: 'driver' });

      await expect(service.startTrip(tripId, callerClerkId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'FORBIDDEN' }),
      });
      expect(mockPrisma.driverTrip.update).not.toHaveBeenCalled();
    });

    it('allows a driver to start their own trip', async () => {
      const tripId = 'trip-uuid-5';
      const driverClerkId = 'clerk-driver-owner-1';
      const driverDbId = 'db-driver-owner-id-1';

      mockPrisma.driverTrip.findUnique.mockResolvedValue({ id: tripId, driverId: driverDbId, status: 'pending' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: driverDbId, clerkId: driverClerkId, role: 'driver' });
      mockPrisma.driverTrip.update.mockResolvedValue({ id: tripId, status: 'in_progress' });

      const result = await service.startTrip(tripId, driverClerkId);

      expect(result).toMatchObject({ status: 'in_progress' });
      expect(mockPrisma.driverTrip.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: tripId } }),
      );
    });

    it('allows an owner caller to start any driver\'s trip', async () => {
      const tripId = 'trip-uuid-6';
      const ownerClerkId = 'clerk-owner-3';

      mockPrisma.driverTrip.findUnique.mockResolvedValue({ id: tripId, driverId: 'some-other-driver', status: 'pending' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'db-owner-id', clerkId: ownerClerkId, role: 'owner' });
      mockPrisma.driverTrip.update.mockResolvedValue({ id: tripId, status: 'in_progress' });

      await expect(service.startTrip(tripId, ownerClerkId)).resolves.toMatchObject({ status: 'in_progress' });
    });
  });

  describe('completeTrip() — ownership guard', () => {
    it('throws ForbiddenException(FORBIDDEN) when a driver completes another driver\'s trip, and never records expenses against it', async () => {
      const tripId = 'trip-uuid-7';
      const callerClerkId = 'clerk-driver-caller-3';
      const callerDbId = 'db-driver-caller-id-3';
      const ownerDbId = 'db-driver-owner-id-3';

      mockPrisma.driverTrip.findUnique.mockResolvedValue({ id: tripId, driverId: ownerDbId, status: 'in_progress' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: callerDbId, clerkId: callerClerkId, role: 'driver' });

      await expect(
        service.completeTrip(tripId, { fuelCost: '20.00' } as any, callerClerkId),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'FORBIDDEN' }),
      });
      expect(mockPrisma.driverTrip.update).not.toHaveBeenCalled();
    });

    it('allows a driver to complete their own trip', async () => {
      const tripId = 'trip-uuid-8';
      const driverClerkId = 'clerk-driver-owner-2';
      const driverDbId = 'db-driver-owner-id-2';

      mockPrisma.driverTrip.findUnique.mockResolvedValue({ id: tripId, driverId: driverDbId, status: 'in_progress' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: driverDbId, clerkId: driverClerkId, role: 'driver' });
      mockPrisma.driverTrip.update.mockResolvedValue({ id: tripId, status: 'completed' });

      await expect(
        service.completeTrip(tripId, { fuelCost: '20.00' } as any, driverClerkId),
      ).resolves.toMatchObject({ status: 'completed' });
    });
  });
});
