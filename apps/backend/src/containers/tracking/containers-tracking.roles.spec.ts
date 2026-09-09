import { describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../auth/roles.guard';
import { ContainersController } from '../containers.controller';
import { ContainersService } from '../containers.service';
import { ContainerTrackingService } from './container-tracking.service';

// ---------------------------------------------------------------------------
// Authorization coverage for the new tracking routes (see task spec section
// "AUTHORIZATION" — must reuse the container's existing read role matrix,
// never widen it). findOne/getTracking/refreshTracking allow
// owner/accountant/sales_rep; listCarriers (the owner-only carrier picker
// backing container edit) is owner-only, matching update()'s existing gate.
// ---------------------------------------------------------------------------

function mockContext(role: string, handlerName: string) {
  const handler = (ContainersController.prototype as any)[handlerName];
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { role, userId: 'user-id' } }) }),
    getHandler: () => handler,
    getClass: () => ContainersController,
  } as any;
}

describe('ContainersController tracking routes — role enforcement', () => {
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

  describe('getTracking (GET /:containerId/tracking)', () => {
    for (const role of ['owner', 'accountant', 'sales_rep']) {
      it(`${role} → allowed`, () => {
        expect(rolesGuard.canActivate(mockContext(role, 'getTracking'))).toBe(true);
      });
    }
    for (const role of ['driver', 'worker', 'receiver']) {
      it(`${role} → ForbiddenException`, () => {
        expect(() => rolesGuard.canActivate(mockContext(role, 'getTracking'))).toThrow(ForbiddenException);
      });
    }
  });

  describe('refreshTracking (POST /:containerId/tracking/refresh)', () => {
    for (const role of ['owner', 'accountant', 'sales_rep']) {
      it(`${role} → allowed`, () => {
        expect(rolesGuard.canActivate(mockContext(role, 'refreshTracking'))).toBe(true);
      });
    }
    for (const role of ['driver', 'worker', 'receiver']) {
      it(`${role} → ForbiddenException`, () => {
        expect(() => rolesGuard.canActivate(mockContext(role, 'refreshTracking'))).toThrow(ForbiddenException);
      });
    }
  });

  describe('listCarriers (GET /tracking/carriers)', () => {
    it('owner → allowed', () => {
      expect(rolesGuard.canActivate(mockContext('owner', 'listCarriers'))).toBe(true);
    });
    for (const role of ['accountant', 'sales_rep', 'driver', 'worker']) {
      it(`${role} → ForbiddenException`, () => {
        expect(() => rolesGuard.canActivate(mockContext(role, 'listCarriers'))).toThrow(ForbiddenException);
      });
    }
  });
});
