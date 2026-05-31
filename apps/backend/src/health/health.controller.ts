import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /health (no auth, no api/v1 prefix). Reports DB connectivity.
   */
  @ApiOperation({ summary: 'Health check — reports DB connectivity' })
  @ApiResponse({ status: 200, description: 'Service is up; includes database connection status' })
  @Public()
  @Get()
  async check() {
    let database = 'disconnected';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'connected';
    } catch {
      database = 'disconnected';
    }

    return { status: 'ok', database };
  }
}
