import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
}
