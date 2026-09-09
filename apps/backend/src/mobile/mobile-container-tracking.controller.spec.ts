import { describe, it, expect, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MobileContainerTrackingController } from './mobile-container-tracking.controller';
import { MobileContainerTrackingService } from './mobile-container-tracking.service';
import { MobileApiSecretGuard } from '../notifications/mobile-api-secret.guard';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

const REAL_SECRET = 'a-very-long-high-entropy-shared-secret-value-1234567890';

describe('MobileContainerTrackingController — authorization + input validation', () => {
  let controller: MobileContainerTrackingController;
  let mockService: any;

  async function build() {
    mockService = { findAll: fn(), findOne: fn(), findEvents: fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MobileContainerTrackingController],
      providers: [
        { provide: MobileContainerTrackingService, useValue: mockService },
        // @UseGuards(MobileApiSecretGuard) on the controller means Nest's
        // DI needs to be able to construct the guard at module-compile
        // time (even though these particular tests call controller methods
        // directly, never through the guard) — a minimal ConfigService stub
        // satisfies that without pulling in the real one.
        MobileApiSecretGuard,
        { provide: ConfigService, useValue: { get: () => REAL_SECRET } },
      ],
    }).compile();
    controller = module.get(MobileContainerTrackingController);
  }

  it('is marked @Public() — the global Clerk JwtAuthGuard/RolesGuard never runs for this controller (there is no Clerk session on this path at all)', () => {
    const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, MobileContainerTrackingController);
    expect(isPublic).toBe(true);
  });

  it('is guarded by MobileApiSecretGuard — the same Phase C credential mechanism, not a second/new one', () => {
    // '__guards__' is @nestjs/common's GUARDS_METADATA key (constants.js) —
    // not re-exported from the public API, so used directly here, exactly
    // as NestJS's own @UseGuards() decorator writes it.
    const guards = Reflect.getMetadata('__guards__', MobileContainerTrackingController) ?? [];
    expect(guards).toContain(MobileApiSecretGuard);
  });

  describe('unauthorized requests are rejected (proves the guard actually enforces, end to end with real ExecutionContext shape)', () => {
    function mockContext(headers: Record<string, string | undefined>) {
      return { switchToHttp: () => ({ getRequest: () => ({ headers }) }) } as any;
    }

    it('rejects a request with no X-Mobile-Api-Secret header', () => {
      const guard = new MobileApiSecretGuard({ get: () => REAL_SECRET } as unknown as ConfigService);
      expect(() => guard.canActivate(mockContext({}))).toThrow();
    });

    it('rejects a request with the wrong secret', () => {
      const guard = new MobileApiSecretGuard({ get: () => REAL_SECRET } as unknown as ConfigService);
      expect(() => guard.canActivate(mockContext({ 'x-mobile-api-secret': 'wrong' }))).toThrow();
    });

    it('allows a request with the correct secret', () => {
      const guard = new MobileApiSecretGuard({ get: () => REAL_SECRET } as unknown as ConfigService);
      expect(guard.canActivate(mockContext({ 'x-mobile-api-secret': REAL_SECRET }))).toBe(true);
    });
  });

  describe('findAll — query validation', () => {
    it('delegates valid params straight to the service', async () => {
      await build();
      mockService.findAll.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
      await controller.findAll(1, 20, 'arrived', 'MSCU');
      expect(mockService.findAll).toHaveBeenCalledWith(1, 20, 'arrived', 'MSCU');
    });

    it('rejects an invalid status value with a clean 400 — never lets it reach Prisma', async () => {
      await build();
      expect(() => controller.findAll(1, 20, 'not-a-real-status')).toThrow(BadRequestException);
      expect(mockService.findAll).not.toHaveBeenCalled();
    });

    it('treats an omitted status as "no filter" (undefined), not invalid', async () => {
      await build();
      mockService.findAll.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
      await controller.findAll(1, 20, undefined, undefined);
      expect(mockService.findAll).toHaveBeenCalledWith(1, 20, undefined, undefined);
    });
  });

  describe('read-only surface — structural proof', () => {
    it('the controller class exposes no mutating HTTP method — only the three documented GET handlers', () => {
      const proto = MobileContainerTrackingController.prototype;
      const methodNames = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
      expect(methodNames.sort()).toEqual(['findAll', 'findOne', 'findEvents'].sort());
      // None of these method names implies a write — a structural sanity
      // check alongside the module-level fact that MobileContainerTrackingService
      // has no dependency on TraqoAccountAllocationService, TraqoKeyResolver,
      // or the tracking provider at all (see mobile.module.ts).
      for (const name of methodNames) {
        expect(name.toLowerCase()).not.toMatch(/create|update|delete|remove|refresh|mutate/);
      }
    });
  });
});
