import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// ISO 639-1-ish language code (e.g. "en", "ar"), plus the literal "auto" for
// source-language auto-detection (supported by the current provider,
// GoogleTranslateProvider, when sourceLanguageCode is omitted from the
// request — see its doc comment). Deliberately permissive about which exact
// codes are valid (that list depends on which languages the active provider
// actually supports — see GET /translations/languages) — this just guards
// against nonsense/oversized input; the provider itself rejects an
// unsupported code, which TranslationService maps to a clean error (see
// translation.service.ts's bad_request handling). Provider-agnostic by
// design — swapping the provider (see translation.provider.ts) never
// requires touching this validation.
const LANGUAGE_CODE_PATTERN = /^[a-zA-Z]{2,3}(-[a-zA-Z]{2,8})?$|^auto$/;

export class TranslateDto {
  @ApiProperty({
    description: 'Text to translate',
    maxLength: 5000,
    example: 'Hello',
  })
  @IsString()
  @IsNotEmpty()
  // App-level cap, independent of any provider-side limit — this app has no
  // legitimate use case for translating multi-thousand-word blocks of text
  // (its only real caller translates short business terms — see
  // src/hooks/useTranslation.ts in the frontend).
  @MaxLength(5000)
  q: string;

  @ApiProperty({
    description: 'Source language code, or "auto" to let the provider detect it',
    example: 'en',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(LANGUAGE_CODE_PATTERN, { message: 'source must be a valid language code (e.g. "en") or "auto"' })
  source: string;

  @ApiProperty({ description: 'Target language code', example: 'ar' })
  @IsString()
  @IsNotEmpty()
  @Matches(LANGUAGE_CODE_PATTERN, { message: 'target must be a valid language code (e.g. "ar")' })
  target: string;
}
