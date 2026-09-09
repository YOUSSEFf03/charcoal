import { describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/roles.guard';
import { ContainersController } from './containers.controller';
import { ContainersService } from './containers.service';
import { ContainerTrackingService } from './tracking/container-tracking.service';

// ---------------------------------------------------------------------------
// Authorization coverage for POST /:id/finalize (Container Finalization +
// History — approved design, section 10/12: "Finalize: OWNER ONLY... do not
// widen access"). findAll (feeding both the main Containers page and the
// new History page via ?finalized=) keeps the existing container read role
// matrix — finalization did not change who can list/view containers.
// ---------------------------------------------------------------------------

function mockContext(role: string, handlerName: string) {
  const handler = (ContainersController.prototype as any)[handlerName];
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { role, userId: 'user-id' } }) }),
    getHandler: () => handler,
    getClass: () => ContainersController,
  } as any;
}

describe('ContainersController finalize route — role enforcement', () => {
  let rolesGuard: RolesGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContainersController],
      providers: [
        { provide: ContainersService, useValue: {} },
        { provide: ContainerTrackingService, useValue: {} },
        Reflector,
        RolesGuard,
      ],
    }).compile();

    rolesGuard = new RolesGuard(module.get<Reflector>(Reflector));
  });

  describe('finalize (POST /:id/finalize)', () => {
    it('owner → allowed', () => {
      expect(rolesGuard.canActivate(mockContext('owner', 'finalize'))).toBe(true);
    });
    for (const role of ['accountant', 'sales_rep', 'driver', 'worker', 'receiver']) {
      it(`${role} → ForbiddenException (finalize is owner-only, matching create/update/delete/discount-write)`, () => {
        expect(() => rolesGuard.canActivate(mockContext(role, 'finalize'))).toThrow(ForbiddenException);
      });
    }
  });

  describe('findAll (GET /?finalized=) — unchanged role matrix for both main list and History page', () => {
    for (const role of ['owner', 'accountant', 'sales_rep']) {
      it(`${role} → allowed`, () => {
        expect(rolesGuard.canActivate(mockContext(role, 'findAll'))).toBe(true);
      });
    }
    for (const role of ['driver', 'worker', 'receiver']) {
      it(`${role} → ForbiddenException`, () => {
        expect(() => rolesGuard.canActivate(mockContext(role, 'findAll'))).toThrow(ForbiddenException);
      });
    }
  });
});
