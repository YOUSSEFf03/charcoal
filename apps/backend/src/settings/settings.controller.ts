import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import { SettingsService } from './settings.service';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

class SetRateDto {
  @IsInt() @Min(1) rate: number;
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
}
