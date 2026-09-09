import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CompanyInfo {
  name: string;
  phone: string;
  address: string;
  addressAr: string;
  taxNo: string;
  email: string;
  footer: string;
}

const COMPANY_INFO_KEY = 'company_info';

const DEFAULT_COMPANY_INFO: CompanyInfo = {
  name: '',
  phone: '',
  address: '',
  addressAr: '',
  taxNo: '',
  email: '',
  footer: '',
};

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getExchangeRate(): Promise<number> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'exchange_rate' } });
    return row ? parseInt(row.value, 10) : 89550;
  }

  async setExchangeRate(rate: number): Promise<number> {
    await this.prisma.setting.upsert({
      where: { key: 'exchange_rate' },
      update: { value: String(Math.round(rate)) },
      create: { key: 'exchange_rate', value: String(Math.round(rate)) },
    });
    return Math.round(rate);
  }

  /**
   * Stored as one JSON-serialized row in the generic Setting {key,value}
   * table (same pattern as exchange_rate) — a dedicated table would be
   * overkill for a single settings object with no independent lifecycle.
   */
  async getCompanyInfo(): Promise<CompanyInfo> {
    const row = await this.prisma.setting.findUnique({ where: { key: COMPANY_INFO_KEY } });
    if (!row) return DEFAULT_COMPANY_INFO;
    try {
      return { ...DEFAULT_COMPANY_INFO, ...JSON.parse(row.value) };
    } catch {
      return DEFAULT_COMPANY_INFO;
    }
  }

  async setCompanyInfo(partial: Partial<CompanyInfo>): Promise<CompanyInfo> {
    const current = await this.getCompanyInfo();
    const next: CompanyInfo = { ...current, ...partial };
    await this.prisma.setting.upsert({
      where: { key: COMPANY_INFO_KEY },
      update: { value: JSON.stringify(next) },
      create: { key: COMPANY_INFO_KEY, value: JSON.stringify(next) },
    });
    return next;
  }

  /**
   * Single global daily-wage amount (USD) — same generic Setting {key,value}
   * pattern as exchange_rate. Employee-detail audit (2026-09-05): this is a
   * GLOBAL, shop-wide figure by explicit product decision — there was no
   * existing daily-wage setting anywhere (global or per-worker) before this;
   * per-worker rates (Worker.ratesPerBagType) remain untouched and unrelated.
   * 0 = "not configured yet" — WorkersService.logDailyWage() refuses to
   * create a $0.00 earning and asks the caller to configure this first.
   */
  async getDailyWageRate(): Promise<number> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'daily_wage_rate' } });
    return row ? parseFloat(row.value) : 0;
  }

  async setDailyWageRate(rate: number): Promise<number> {
    await this.prisma.setting.upsert({
      where: { key: 'daily_wage_rate' },
      update: { value: String(rate) },
      create: { key: 'daily_wage_rate', value: String(rate) },
    });
    return rate;
  }
}
