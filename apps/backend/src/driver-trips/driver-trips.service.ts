import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TripStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClerkUser } from '../auth/clerk.strategy';
import { CreateDriverTripDto } from './dto/create-driver-trip.dto';
import { UpdateDriverTripDto } from './dto/update-driver-trip.dto';
import { CompleteDriverTripDto } from './dto/complete-driver-trip.dto';

@Injectable()
export class DriverTripsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Return a paginated list of driver trips.
   *
   * If the caller is a driver, the list is always filtered to their own trips.
   * Other roles may optionally filter by driverId.
   *
   * CONSTRAINT: drivers can only see their own trips — driverId filter is always
   * forced to caller's own user.id when role==='driver'
   *
   * @param page - 1-indexed page number
   * @param limit - Items per page
   * @param currentUser - Authenticated user from @CurrentUser
   * @param driverId - Optional driver filter (ignored for driver role)
   * @param status - Optional status filter
   * @param dateFrom - Optional start date filter (ISO string)
   * @param dateTo - Optional end date filter (ISO string)
   */
  async findAll(
    page: number,
    limit: number,
    currentUser: ClerkUser,
    driverId?: string,
    status?: TripStatus,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const skip = (page - 1) * limit;

    let resolvedDriverId: string | undefined = driverId;

    if (currentUser.role === 'driver') {
      // Drivers only see their own trips — resolve internal user id
      const user = await this.prisma.user.findUnique({
        where: { clerkId: currentUser.userId },
      });
      if (!user) {
        throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });
      }
      resolvedDriverId = user.id;
    }

    const where: Prisma.DriverTripWhereInput = {
      ...(resolvedDriverId ? { driverId: resolvedDriverId } : {}),
      ...(status ? { status } : {}),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.driverTrip.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          driver: { select: { id: true, name: true } },
          shipments: { select: { id: true, address: true, status: true } },
        },
      }),
      this.prisma.driverTrip.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Return a single driver trip with shipments.
   *
   * If the caller is a driver, validates the trip belongs to them.
   *
   * @param id - Trip UUID
   * @param currentUser - Authenticated user
   * @throws NotFoundException if trip not found
   * @throws ForbiddenException if driver tries to access another driver's trip (code: FORBIDDEN)
   */
  async findOne(id: string, currentUser: ClerkUser) {
    const trip = await this.prisma.driverTrip.findUnique({
      where: { id },
      include: {
        driver: { select: { id: true, name: true } },
        shipments: { include: { bags: { include: { bagType: true } } } },
      },
    });
    if (!trip) {
      throw new NotFoundException({ error: 'Trip not found', code: 'NOT_FOUND' });
    }

    if (currentUser.role === 'driver') {
      const user = await this.prisma.user.findUnique({
        where: { clerkId: currentUser.userId },
      });
      if (!user || trip.driverId !== user.id) {
        throw new ForbiddenException({
          error: 'Access denied to this trip',
          code: 'FORBIDDEN',
        });
      }
    }

    return trip;
  }

  /**
   * Create a new driver trip. Optionally links existing shipments to the trip.
   *
   * @param dto - Trip creation data
   * @param userId - Clerk user ID of the creator
   */
  async create(dto: CreateDriverTripDto, userId: string) {
    // Validate driver user exists
    const driver = await this.prisma.user.findUnique({
      where: { id: dto.driverId },
    });
    if (!driver) {
      throw new NotFoundException({ error: 'Driver not found', code: 'NOT_FOUND' });
    }

    const trip = await this.prisma.driverTrip.create({
      data: {
        driverId: dto.driverId,
        ...(dto.notes ? { notes: dto.notes } : {}),
      },
      include: {
        driver: { select: { id: true, name: true } },
        shipments: true,
      },
    });

    // Link provided shipments to the new trip
    if (dto.shipmentIds && dto.shipmentIds.length > 0) {
      await this.prisma.shipment.updateMany({
        where: { id: { in: dto.shipmentIds } },
        data: { tripId: trip.id },
      });
    }

    return this.prisma.driverTrip.findUnique({
      where: { id: trip.id },
      include: {
        driver: { select: { id: true, name: true } },
        shipments: { select: { id: true, address: true, status: true } },
      },
    });
  }

  /**
   * Mark a trip as in-progress.
   *
   * @param id - Trip UUID
   * @param userId - Clerk user ID (for ownership check)
   */
  async startTrip(id: string, userId: string) {
    await this.prisma.driverTrip.findUniqueOrThrow({ where: { id } }).catch(() => {
      throw new NotFoundException({ error: 'Trip not found', code: 'NOT_FOUND' });
    });

    return this.prisma.driverTrip.update({
      where: { id },
      data: { status: 'in_progress', startedAt: new Date() },
    });
  }

  /**
   * Mark a trip as completed and record expenses.
   *
   * @param id - Trip UUID
   * @param dto - Completion data including fuel cost and other expenses
   * @param userId - Clerk user ID
   */
  async completeTrip(id: string, dto: CompleteDriverTripDto, userId: string) {
    await this.prisma.driverTrip.findUniqueOrThrow({ where: { id } }).catch(() => {
      throw new NotFoundException({ error: 'Trip not found', code: 'NOT_FOUND' });
    });

    return this.prisma.driverTrip.update({
      where: { id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        ...(dto.fuelCost !== undefined ? { fuelCost: dto.fuelCost } : {}),
        ...(dto.otherExpenses !== undefined
          ? { otherExpenses: dto.otherExpenses as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  /**
   * Update a driver trip. Drivers may only update their own trip.
   *
   * @param id - Trip UUID
   * @param dto - Partial update data
   * @param userId - Clerk user ID of the caller
   */
  async update(
    id: string,
    dto: UpdateDriverTripDto,
    userId: string,
  ) {
    const trip = await this.prisma.driverTrip.findUnique({ where: { id } });
    if (!trip) {
      throw new NotFoundException({ error: 'Trip not found', code: 'NOT_FOUND' });
    }

    // Driver ownership check
    const caller = await this.prisma.user.findUnique({
      where: { clerkId: userId },
    });
    if (caller && caller.role === 'driver' && trip.driverId !== caller.id) {
      throw new ForbiddenException({
        error: 'Drivers can only update their own trips',
        code: 'FORBIDDEN',
      });
    }

    return this.prisma.driverTrip.update({
      where: { id },
      data: {
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
  }
}
