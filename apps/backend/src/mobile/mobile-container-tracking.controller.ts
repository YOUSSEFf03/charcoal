import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ContainerStatus } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { MobileApiSecretGuard } from '../notifications/mobile-api-secret.guard';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { MobileContainerTrackingService } from './mobile-container-tracking.service';

/**
 * Dedicated, read-only container-tracking API for the mobile app — never
 * ContainersController's own responses (which include the full Supplier
 * relation — bankDetails, contactPersons — plus every accounting field; see
 * MobileContainerTrackingService's doc comment). Protected the same way
 * mobile/devices already is (Phase C): @Public() skips the Clerk-session
 * JwtAuthGuard/RolesGuard entirely (there is no Clerk session on this path),
 * and MobileApiSecretGuard is the real authorization — the same shared
 * high-entropy secret, reused as-is, not a second auth mechanism.
 *
 * Every route here is a GET. There is deliberately no POST/PATCH/DELETE
 * anywhere in this controller — mutating a container, refreshing its
 * tracking, or changing its status remain exclusively backend/web
 * responsibilities (ContainersController, ContainerTrackingService, the
 * Phase A scheduler). This file has no dependency capable of writing to
 * Container/ContainerTracking at all, by construction.
 */
@ApiExcludeController()
@Controller('mobile/container-tracking')
@Public()
@UseGuards(MobileApiSecretGuard)
export class MobileContainerTrackingController {
  constructor(private readonly mobileTracking: MobileContainerTrackingService) {}

  @Get()
  findAll(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    // Explicit validation rather than the web ContainersController's `as any`
    // cast — an invalid enum value passed straight to Prisma throws a raw
    // PrismaClientValidationError, which is exactly the "leaked internal
    // Prisma error" this phase's error-handling requirements call out.
    if (status !== undefined && !Object.values(ContainerStatus).includes(status as ContainerStatus)) {
      throw new BadRequestException({
        error: `Invalid status filter. Must be one of: ${Object.values(ContainerStatus).join(', ')}`,
        code: 'INVALID_STATUS',
      });
    }
    return this.mobileTracking.findAll(page, limit, status as ContainerStatus | undefined, search);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.mobileTracking.findOne(id);
  }

  @Get(':id/events')
  findEvents(@Param('id', ParseUUIDPipe) id: string) {
    return this.mobileTracking.findEvents(id);
  }
}
