import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { SuppliersController } from '../suppliers/suppliers.controller';
import { SuppliersService } from '../suppliers/suppliers.service';
import { BagTypesController } from '../bag-types/bag-types.controller';
import { BagTypesService } from '../bag-types/bag-types.service';
import { PackedStockController } from '../packed-stock/packed-stock.controller';
import { PackedStockService } from '../packed-stock/packed-stock.service';
import { WarehouseController } from '../warehouse/warehouse.controller';
import { WarehouseService } from '../warehouse/warehouse.service';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import { CashHandoversController } from '../cash-handovers/cash-handovers.controller';
import { CashHandoversService } from '../cash-handovers/cash-handovers.service';

// ---------------------------------------------------------------------------
// Regression coverage for a real, reachable authorization gap found during
// an application-wide bug audit: SuppliersController.findAll/findOne and the
// single route each on BagTypesController/PackedStockController/
// WarehouseController had NO @Roles() decorator at all. Per RolesGuard's own
// documented behavior ("no @Roles() => any authenticated role passes"), this
// let a driver or worker read supplier cost/pricing data (a documented
// sensitivity violation — see reports.controller.ts's own supplier-cost
// redaction for sales_rep) and unredacted cost fields the sibling
// stock-lots.controller.ts already correctly gates. Follows the exact same
// RolesGuard-unit-test pattern already established in
// reports.service.spec.ts's "ReportsController — role enforcement" block.
// ---------------------------------------------------------------------------

function mockContext(controllerClass: any, role: string, handlerName: string) {
  const handler = (controllerClass.prototype as any)[handlerName];
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { role, userId: 'user-id' } }) }),
    getHandler: () => handler,
    getClass: () => controllerClass,
  } as any;
}

describe('SuppliersController — role enforcement', () => {
  let rolesGuard: RolesGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SuppliersController],
      providers: [
        { provide: SuppliersService, useValue: {} },
        Reflector,
        RolesGuard,
      ],
    }).compile();

    rolesGuard = new RolesGuard(module.get<Reflector>(Reflector));
  });

  it('findAll: driver → ForbiddenException (supplier cost data is sensitive)', () => {
    expect(() => rolesGuard.canActivate(mockContext(SuppliersController, 'driver', 'findAll'))).toThrow(ForbiddenException);
  });
  it('findAll: worker → ForbiddenException', () => {
    expect(() => rolesGuard.canActivate(mockContext(SuppliersController, 'worker', 'findAll'))).toThrow(ForbiddenException);
  });
  it('findAll: sales_rep → ForbiddenException', () => {
    expect(() => rolesGuard.canActivate(mockContext(SuppliersController, 'sales_rep', 'findAll'))).toThrow(ForbiddenException);
  });
  it('findAll: accountant → passes', () => {
    expect(rolesGuard.canActivate(mockContext(SuppliersController, 'accountant', 'findAll'))).toBe(true);
  });
  it('findAll: owner → passes', () => {
    expect(rolesGuard.canActivate(mockContext(SuppliersController, 'owner', 'findAll'))).toBe(true);
  });

  it('findOne: driver → ForbiddenException', () => {
    expect(() => rolesGuard.canActivate(mockContext(SuppliersController, 'driver', 'findOne'))).toThrow(ForbiddenException);
  });
  it('findOne: accountant → passes', () => {
    expect(rolesGuard.canActivate(mockContext(SuppliersController, 'accountant', 'findOne'))).toBe(true);
  });
});

describe('BagTypesController — role enforcement', () => {
  let rolesGuard: RolesGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BagTypesController],
      providers: [
        { provide: BagTypesService, useValue: {} },
        Reflector,
        RolesGuard,
      ],
    }).compile();

    rolesGuard = new RolesGuard(module.get<Reflector>(Reflector));
  });

  it('findAll: driver → ForbiddenException (costPerBag/workerRate must never reach driver)', () => {
    expect(() => rolesGuard.canActivate(mockContext(BagTypesController, 'driver', 'findAll'))).toThrow(ForbiddenException);
  });
  it('findAll: worker → passes (service-level redaction strips cost fields)', () => {
    expect(rolesGuard.canActivate(mockContext(BagTypesController, 'worker', 'findAll'))).toBe(true);
  });
  it('findAll: sales_rep → passes', () => {
    expect(rolesGuard.canActivate(mockContext(BagTypesController, 'sales_rep', 'findAll'))).toBe(true);
  });
  it('findOne: driver → ForbiddenException', () => {
    expect(() => rolesGuard.canActivate(mockContext(BagTypesController, 'driver', 'findOne'))).toThrow(ForbiddenException);
  });
});

describe('PackedStockController — role enforcement', () => {
  let rolesGuard: RolesGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PackedStockController],
      providers: [
        { provide: PackedStockService, useValue: {} },
        Reflector,
        RolesGuard,
      ],
    }).compile();

    rolesGuard = new RolesGuard(module.get<Reflector>(Reflector));
  });

  it('findSummary: driver → ForbiddenException', () => {
    expect(() => rolesGuard.canActivate(mockContext(PackedStockController, 'driver', 'findSummary'))).toThrow(ForbiddenException);
  });
  it('getFifoDraw: driver → ForbiddenException', () => {
    expect(() => rolesGuard.canActivate(mockContext(PackedStockController, 'driver', 'getFifoDraw'))).toThrow(ForbiddenException);
  });
  it('findAll: driver → ForbiddenException', () => {
    expect(() => rolesGuard.canActivate(mockContext(PackedStockController, 'driver', 'findAll'))).toThrow(ForbiddenException);
  });
  it('findAll: worker → passes', () => {
    expect(rolesGuard.canActivate(mockContext(PackedStockController, 'worker', 'findAll'))).toBe(true);
  });
});

describe('WarehouseController — role enforcement', () => {
  let rolesGuard: RolesGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WarehouseController],
      providers: [
        { provide: WarehouseService, useValue: {} },
        Reflector,
        RolesGuard,
      ],
    }).compile();

    rolesGuard = new RolesGuard(module.get<Reflector>(Reflector));
  });

  it('getSummary: driver → ForbiddenException (estimatedTotalValue must never reach driver)', () => {
    expect(() => rolesGuard.canActivate(mockContext(WarehouseController, 'driver', 'getSummary'))).toThrow(ForbiddenException);
  });
  it('getSummary: worker → passes (service-level redaction strips estimatedTotalValue)', () => {
    expect(rolesGuard.canActivate(mockContext(WarehouseController, 'worker', 'getSummary'))).toBe(true);
  });
  it('getSummary: sales_rep → passes', () => {
    expect(rolesGuard.canActivate(mockContext(WarehouseController, 'sales_rep', 'getSummary'))).toBe(true);
  });
  it('getSummary: accountant → passes', () => {
    expect(rolesGuard.canActivate(mockContext(WarehouseController, 'accountant', 'getSummary'))).toBe(true);
  });
});

describe('UsersController — role enforcement (GET /users/receivers method-level override)', () => {
  let rolesGuard: RolesGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: {} },
        Reflector,
        RolesGuard,
      ],
    }).compile();

    rolesGuard = new RolesGuard(module.get<Reflector>(Reflector));
  });

  // The controller class carries @Roles('owner') — findAll must still inherit
  // that, since it exposes full User rows (email/phone).
  it('findAll: accountant → ForbiddenException (inherits the class-level owner-only gate)', () => {
    expect(() => rolesGuard.canActivate(mockContext(UsersController, 'accountant', 'findAll'))).toThrow(ForbiddenException);
  });
  it('findAll: owner → passes', () => {
    expect(rolesGuard.canActivate(mockContext(UsersController, 'owner', 'findAll'))).toBe(true);
  });

  // findReceivers has its own @Roles() that must override the class-level
  // owner-only default — every page that logs a payment (Payment, Invoices,
  // ClientDetail, WarehouseSales) has no role restriction of its own, so an
  // accountant/sales_rep/worker/receiver picking a receiver there would
  // otherwise 403 fetching this list.
  it('findReceivers: accountant → passes (method-level override)', () => {
    expect(rolesGuard.canActivate(mockContext(UsersController, 'accountant', 'findReceivers'))).toBe(true);
  });
  it('findReceivers: sales_rep → passes', () => {
    expect(rolesGuard.canActivate(mockContext(UsersController, 'sales_rep', 'findReceivers'))).toBe(true);
  });
  it('findReceivers: worker → passes', () => {
    expect(rolesGuard.canActivate(mockContext(UsersController, 'worker', 'findReceivers'))).toBe(true);
  });
  it('findReceivers: receiver → passes', () => {
    expect(rolesGuard.canActivate(mockContext(UsersController, 'receiver', 'findReceivers'))).toBe(true);
  });
  it('findReceivers: owner → passes', () => {
    expect(rolesGuard.canActivate(mockContext(UsersController, 'owner', 'findReceivers'))).toBe(true);
  });
  // Drivers collect cash-on-delivery auto-attributed to ClientOrder.driverId
  // (shipments.service.ts PR 10.1) — never manually pick a receiver — so
  // driver is deliberately excluded from this list's role set.
  it('findReceivers: driver → ForbiddenException', () => {
    expect(() => rolesGuard.canActivate(mockContext(UsersController, 'driver', 'findReceivers'))).toThrow(ForbiddenException);
  });
});

// Money Handover History redesign — confirms the class-level @Roles('owner',
// 'accountant') gate (unchanged by this task) actually holds for findAll,
// since the frontend history table's own error-state test relies on a real
// 403 being reachable for every other role.
describe('CashHandoversController — role enforcement', () => {
  let rolesGuard: RolesGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CashHandoversController],
      providers: [
        { provide: CashHandoversService, useValue: {} },
        Reflector,
        RolesGuard,
      ],
    }).compile();

    rolesGuard = new RolesGuard(module.get<Reflector>(Reflector));
  });

  it('findAll: owner → passes', () => {
    expect(rolesGuard.canActivate(mockContext(CashHandoversController, 'owner', 'findAll'))).toBe(true);
  });
  it('findAll: accountant → passes', () => {
    expect(rolesGuard.canActivate(mockContext(CashHandoversController, 'accountant', 'findAll'))).toBe(true);
  });
  it('findAll: sales_rep → ForbiddenException', () => {
    expect(() => rolesGuard.canActivate(mockContext(CashHandoversController, 'sales_rep', 'findAll'))).toThrow(ForbiddenException);
  });
  it('findAll: worker → ForbiddenException', () => {
    expect(() => rolesGuard.canActivate(mockContext(CashHandoversController, 'worker', 'findAll'))).toThrow(ForbiddenException);
  });
  it('findAll: driver → ForbiddenException', () => {
    expect(() => rolesGuard.canActivate(mockContext(CashHandoversController, 'driver', 'findAll'))).toThrow(ForbiddenException);
  });
  it('findAll: receiver → ForbiddenException', () => {
    expect(() => rolesGuard.canActivate(mockContext(CashHandoversController, 'receiver', 'findAll'))).toThrow(ForbiddenException);
  });
});
