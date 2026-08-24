import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { Roles } from '../auth/roles.decorator';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class CreateLocalUserDto {
  @ApiProperty({ description: 'Display name' })
  @IsString()
  name: string;

  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role: Role;

  @ApiProperty({ required: false, description: 'Optional phone or label' })
  @IsOptional()
  @IsString()
  phone?: string;
}

class UpdateUserNameDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phone?: string | null;
}

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@Roles('owner')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: 'List users, optionally filtered by role' })
  @ApiResponse({ status: 200, description: 'Paginated user list' })
  @Get()
  findAll(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @Query('role') role?: string,
  ) {
    const roleEnum = role && Object.values(Role).includes(role as Role) ? (role as Role) : undefined;
    return this.usersService.findAll(page, limit, roleEnum);
  }

  /**
   * Minimal, unbounded list of every user who can be a cash payment
   * receiver (owner/accountant/sales_rep/worker/receiver — not driver, whose
   * cash-on-delivery collection is auto-attributed to ClientOrder.driverId,
   * never manually picked — see shipments.service.ts PR 10.1). Deliberately
   * NOT gated to owner like the rest of this controller: every page that logs
   * a payment (Payment, Invoices, ClientDetail, WarehouseSales) has no role
   * restriction of its own, so an accountant/sales_rep/worker picking a
   * receiver there would otherwise 403 fetching this list — id/name/role
   * only, never the full User row (email/phone stay owner-only via GET /users).
   *
   * IMPORTANT: must come before GET /:id so Nest does not treat "receivers"
   * as a UUID route param.
   */
  @ApiOperation({ summary: 'Minimal id/name/role list of every cash-capable user, unbounded — for payment "received by" pickers' })
  @ApiResponse({ status: 200, description: 'Success' })
  @Get('receivers')
  @Roles('owner', 'accountant', 'sales_rep', 'worker', 'receiver')
  findReceivers() {
    return this.usersService.findReceivers();
  }

  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  @ApiOperation({ summary: 'Create a local (non-Clerk) user — for receivers and internal accounts' })
  @ApiResponse({ status: 201 })
  @Post()
  createLocal(@Body() dto: CreateLocalUserDto) {
    return this.usersService.createLocal(dto.name, dto.role, dto.phone);
  }

  @ApiOperation({ summary: 'Update user role' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  @Patch(':id/role')
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    return this.usersService.updateRole(id, dto.role);
  }

  @ApiOperation({ summary: 'Update user name / phone (local users only for name; all for phone)' })
  @ApiResponse({ status: 200 })
  @Patch(':id/name')
  updateName(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserNameDto,
  ) {
    return this.usersService.updateName(id, dto.name, dto.phone);
  }

  @ApiOperation({ summary: 'Delete a local user (clerkId must start with "local_")' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Cannot delete Clerk-linked users here' })
  @Delete(':id')
  deleteLocal(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.deleteLocal(id);
  }
}
