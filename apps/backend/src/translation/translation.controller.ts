import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TranslationService } from './translation.service';
import { TranslateDto } from './dto/translate.dto';

/**
 * No @Roles() on either endpoint — translation is a generic utility, not a
 * business-sensitive operation, so any authenticated user may call it. Per
 * RolesGuard (../auth/roles.guard.ts): omitting @Roles() means authenticated
 * access alone is sufficient — JwtAuthGuard (applied globally) still runs
 * first, so both endpoints require a valid session either way.
 */
@ApiTags('translations')
@ApiBearerAuth()
@Controller('translations')
export class TranslationController {
  constructor(private readonly translationService: TranslationService) {}

  @ApiOperation({ summary: 'Translate text via Google Cloud Translation' })
  @ApiResponse({ status: 200, description: 'Translated text returned' })
  @ApiResponse({ status: 400, description: 'Unsupported language pair, or text too long' })
  @ApiResponse({ status: 422, description: 'Validation error (empty text, malformed language code)' })
  @ApiResponse({ status: 429, description: 'Translation rate limit reached' })
  @ApiResponse({ status: 502, description: 'Translation service returned an invalid/unexpected response' })
  @ApiResponse({ status: 503, description: 'Translation service unavailable' })
  @Post()
  translate(@Body() dto: TranslateDto) {
    return this.translationService.translate(dto.q, dto.source, dto.target);
  }

  @ApiOperation({ summary: 'List languages the translation service currently supports' })
  @ApiResponse({ status: 200, description: 'Supported languages returned' })
  @ApiResponse({ status: 503, description: 'Translation service unavailable' })
  @Get('languages')
  listLanguages() {
    return this.translationService.listLanguages();
  }
}
