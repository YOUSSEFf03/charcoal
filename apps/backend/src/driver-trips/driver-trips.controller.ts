import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TripStatus } from '@prisma/client';
import { DriverTripsService } from './driver-trips.service';
import { CreateDriverTripDto } from './dto/create-driver-trip.dto';
import { UpdateDriverTripDto } from './dto/update-driver-trip.dto';
import { CompleteDriverTripDto } from './dto/complete-driver-trip.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('driver-trips')
@ApiBearerAuth()
@Controller('driver-trips')
export class DriverTripsController {
  constructor(private readonly driverTripsService: DriverTripsService) {}

  /**
   * No @Roles() decorator — global JwtAuthGuard handles auth.
   * Filtering by caller role is handled inside the service.
   */
  @ApiOperation({ summary: 'List driver trips (driver sees own only)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @Get()
  findAll(
    @CurrentUser() currentUser: ClerkUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('driverId') driverId?: string,
    @Query('status') status?: TripStatus,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.driverTripsService.findAll(
      page,
      limit,
      currentUser,
      driverId,
      status,
      dateFrom,
      dateTo,
    );
  }

  @ApiOperation({ summary: 'Get a driver trip by ID' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id')
  @Roles('owner', 'sales_rep', 'driver')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: ClerkUser,
  ) {
    return this.driverTripsService.findOne(id, currentUser);
  }

  @ApiOperation({ summary: 'Create a new driver trip' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Post()
  @Roles('owner', 'sales_rep')
  create(
    @Body() dto: CreateDriverTripDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.driverTripsService.create(dto, user.userId);
  }

  @ApiOperation({ summary: 'Update a driver trip (notes only)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Patch(':id')
  @Roles('owner', 'driver')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDriverTripDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.driverTripsService.update(id, dto, user.userId);
  }

  @ApiOperation({ summary: 'Start a driver trip' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Post(':id/start')
  @Roles('driver', 'owner')
  startTrip(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.driverTripsService.startTrip(id, user.userId);
  }

  @ApiOperation({ summary: 'Complete a driver trip and record expenses' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Post(':id/complete')
  @Roles('driver', 'owner')
  completeTrip(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteDriverTripDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.driverTripsService.completeTrip(id, dto, user.userId);
  }
}
