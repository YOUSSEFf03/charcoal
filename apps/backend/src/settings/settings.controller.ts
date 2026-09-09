import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsInt, IsNumber, Min } from 'class-validator';
import { SettingsService } from './settings.service';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { UpdateCompanyInfoDto } from './dto/update-company-info.dto';

class SetRateDto {
  @IsInt() @Min(1) rate: number;
}

class SetDailyWageDto {
  @IsNumber() @Min(0) rate: number;
}

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @ApiOperation({ summary: 'Get current USD/LBP exchange rate' })
  @Get('exchange-rate')
  @Public()
  async getExchangeRate() {
    const rate = await this.settingsService.getExchangeRate();
    return { rate };
  }

  @ApiOperation({ summary: 'Update USD/LBP exchange rate (owner only)' })
  @Put('exchange-rate')
  @Roles('owner')
  async setExchangeRate(@Body() dto: SetRateDto) {
    const rate = await this.settingsService.setExchangeRate(dto.rate);
    return { rate };
  }

  @ApiOperation({ summary: 'Get company info (name/address/phone/etc. shown on invoices and receipts)' })
  @Get('company-info')
  async getCompanyInfo() {
    return this.settingsService.getCompanyInfo();
  }

  @ApiOperation({ summary: 'Update company info (owner only)' })
  @Put('company-info')
  @Roles('owner')
  async setCompanyInfo(@Body() dto: UpdateCompanyInfoDto) {
    return this.settingsService.setCompanyInfo(dto);
  }

  @ApiOperation({ summary: 'Get the configured global daily-wage amount (USD), used by the Employee Detail "Daily wage" button' })
  @Get('daily-wage')
  async getDailyWage() {
    const rate = await this.settingsService.getDailyWageRate();
    return { rate };
  }

  @ApiOperation({ summary: 'Update the global daily-wage amount (owner only)' })
  @Put('daily-wage')
  @Roles('owner')
  async setDailyWage(@Body() dto: SetDailyWageDto) {
    const rate = await this.settingsService.setDailyWageRate(dto.rate);
    return { rate };
  }
}
