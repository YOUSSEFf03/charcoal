import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { SettingsService } from './settings.service';
import { PrismaService } from '../prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

describe('SettingsService — company info', () => {
  let service: SettingsService;
  let prisma: any;

  beforeEach(() => {
    prisma = { setting: { findUnique: fn(), upsert: fn() } };
    service = new SettingsService(prisma as unknown as PrismaService);
  });

  describe('getCompanyInfo', () => {
    it('returns defaults (all empty strings) when nothing has ever been saved', async () => {
      prisma.setting.findUnique.mockResolvedValue(null);
      const result = await service.getCompanyInfo();
      expect(result).toEqual({ name: '', phone: '', address: '', addressAr: '', taxNo: '', email: '', footer: '' });
    });

    it('returns the parsed, previously-saved value', async () => {
      prisma.setting.findUnique.mockResolvedValue({
        key: 'company_info',
        value: JSON.stringify({ name: 'Farah Charcoal', phone: '+961 1 234 567', address: 'Beirut', addressAr: '', taxNo: '', email: '', footer: '' }),
      });
      const result = await service.getCompanyInfo();
      expect(result.name).toBe('Farah Charcoal');
      expect(result.phone).toBe('+961 1 234 567');
    });

    it('falls back to defaults on corrupted stored JSON rather than throwing', async () => {
      prisma.setting.findUnique.mockResolvedValue({ key: 'company_info', value: 'not json' });
      const result = await service.getCompanyInfo();
      expect(result.name).toBe('');
    });
  });

  describe('setCompanyInfo', () => {
    it('merges the partial update onto the existing stored value and upserts as JSON', async () => {
      prisma.setting.findUnique.mockResolvedValue({
        key: 'company_info',
        value: JSON.stringify({ name: 'Old Name', phone: '111', address: '', addressAr: '', taxNo: '', email: '', footer: '' }),
      });

      const result = await service.setCompanyInfo({ name: 'New Name' });

      expect(result.name).toBe('New Name');
      expect(result.phone).toBe('111'); // untouched fields preserved
      expect(prisma.setting.upsert).toHaveBeenCalledWith({
        where: { key: 'company_info' },
        update: { value: JSON.stringify(result) },
        create: { key: 'company_info', value: JSON.stringify(result) },
      });
    });

    it('creates a fresh row from defaults when nothing was saved before', async () => {
      prisma.setting.findUnique.mockResolvedValue(null);
      const result = await service.setCompanyInfo({ name: 'Farah Charcoal', email: 'a@b.com' });
      expect(result).toEqual({ name: 'Farah Charcoal', phone: '', address: '', addressAr: '', taxNo: '', email: 'a@b.com', footer: '' });
    });
  });

  // Employee-detail audit (2026-09-05): a single global daily-wage amount,
  // same {key,value} pattern as exchange_rate — see that method's doc comment
  // for why this is global rather than per-worker.
  describe('getDailyWageRate / setDailyWageRate', () => {
    it('returns 0 ("not configured") when nothing has ever been saved', async () => {
      prisma.setting.findUnique.mockResolvedValue(null);
      const result = await service.getDailyWageRate();
      expect(result).toBe(0);
    });

    it('returns the previously-saved rate, parsed as a number', async () => {
      prisma.setting.findUnique.mockResolvedValue({ key: 'daily_wage_rate', value: '20' });
      const result = await service.getDailyWageRate();
      expect(result).toBe(20);
    });

    it('setDailyWageRate upserts under its own key, independent of exchange_rate/company_info', async () => {
      const result = await service.setDailyWageRate(25);
      expect(result).toBe(25);
      expect(prisma.setting.upsert).toHaveBeenCalledWith({
        where: { key: 'daily_wage_rate' },
        update: { value: '25' },
        create: { key: 'daily_wage_rate', value: '25' },
      });
    });
  });
});
