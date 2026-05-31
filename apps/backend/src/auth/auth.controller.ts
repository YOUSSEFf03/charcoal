import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/v1/auth/me — returns the current user's DB record, looked up by
   * the Clerk user id (stored as clerkId).
   */
  @ApiOperation({ summary: 'Get the currently authenticated user record' })
  @ApiResponse({ status: 200, description: 'Current user record' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User record not found' })
  @Get('me')
  async me(@CurrentUser('userId') userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      throw new NotFoundException({
        error: 'User record not found',
        code: 'NOT_FOUND',
      });
    }

    return user;
  }
}
