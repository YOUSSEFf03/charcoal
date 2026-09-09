import { describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/roles.guard';
import { TranslationController } from './translation.controller';
import { TranslationService } from './translation.service';

// ---------------------------------------------------------------------------
// Authorization coverage for POST /translations and GET /translations/languages
// — deliberate design decision: translation is a generic utility, not a
// business-sensitive operation, so ANY authenticated role may call it (no
// @Roles() decorator on either handler). This test locks that contract in —
// if someone later adds a @Roles() restriction without updating this test,
// it fails loudly instead of silently narrowing access. Authentication
// itself (JwtAuthGuard, rejecting requests with no/invalid token) is a
// separate, already-covered global concern — RolesGuard only ever sees
// requests that already passed it.
// ---------------------------------------------------------------------------

const ALL_ROLES = ['owner', 'accountant', 'sales_rep', 'worker', 'driver', 'receiver'];

function mockContext(role: string, handlerName: string) {
  const handler = (TranslationController.prototype as any)[handlerName]; // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { role, userId: 'user-id' } }) }),
    getHandler: () => handler,
    getClass: () => TranslationController,
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe('TranslationController — role enforcement', () => {
  let rolesGuard: RolesGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TranslationController],
      providers: [{ provide: TranslationService, useValue: {} }, Reflector, RolesGuard],
    }).compile();

    rolesGuard = new RolesGuard(module.get<Reflector>(Reflector));
  });

  describe('translate (POST /translations)', () => {
    for (const role of ALL_ROLES) {
      it(`${role} → allowed`, () => {
        expect(rolesGuard.canActivate(mockContext(role, 'translate'))).toBe(true);
      });
    }
  });

  describe('listLanguages (GET /translations/languages)', () => {
    for (const role of ALL_ROLES) {
      it(`${role} → allowed`, () => {
        expect(rolesGuard.canActivate(mockContext(role, 'listLanguages'))).toBe(true);
      });
    }
  });
});
