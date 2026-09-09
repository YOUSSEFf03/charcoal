import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  SupportedLanguage,
  TRANSLATION_PROVIDER,
  TranslationErrorKind,
  TranslationProvider,
  TranslationProviderError,
} from './translation.provider';

const HTTP_STATUS_BY_KIND: Record<TranslationErrorKind, HttpStatus> = {
  network_error: HttpStatus.SERVICE_UNAVAILABLE,
  bad_request: HttpStatus.BAD_REQUEST,
  rate_limited: HttpStatus.TOO_MANY_REQUESTS,
  forbidden: HttpStatus.BAD_GATEWAY,
  invalid_response: HttpStatus.BAD_GATEWAY,
  upstream_error: HttpStatus.BAD_GATEWAY,
};

/**
 * Business-friendly messages for each provider failure kind. Never derived
 * from the provider's raw response — these are our own fixed copy. Mirrors
 * ContainerTrackingService's publicMessage()/toHttpException() pattern
 * exactly (../containers/tracking/container-tracking.service.ts).
 */
function publicMessage(e: TranslationProviderError): string {
  switch (e.kind) {
    case 'network_error':
      return 'Translation is temporarily unavailable. Please try again later.';
    case 'bad_request':
      return "This language pair isn't supported, or the text is too long. Please check and try again.";
    case 'rate_limited':
      return 'Translation rate limit reached. Please try again shortly.';
    case 'forbidden':
    case 'invalid_response':
    case 'upstream_error':
    default:
      return 'Translation is temporarily unavailable. Please try again later.';
  }
}

function toHttpException(e: TranslationProviderError): HttpException {
  return new HttpException(
    {
      error: publicMessage(e),
      code: `TRANSLATION_${e.kind.toUpperCase()}`,
      ...(e.retryAfterSeconds ? { details: { retryAfterSeconds: e.retryAfterSeconds } } : {}),
    },
    HTTP_STATUS_BY_KIND[e.kind] ?? HttpStatus.BAD_GATEWAY,
  );
}

@Injectable()
export class TranslationService {
  constructor(
    @Inject(TRANSLATION_PROVIDER) private readonly provider: TranslationProvider,
  ) {}

  async translate(text: string, source: string, target: string): Promise<{ translatedText: string }> {
    try {
      return await this.provider.translate(text, source, target);
    } catch (e) {
      if (e instanceof TranslationProviderError) throw toHttpException(e);
      throw e;
    }
  }

  async listLanguages(): Promise<SupportedLanguage[]> {
    try {
      return await this.provider.listLanguages();
    } catch (e) {
      if (e instanceof TranslationProviderError) throw toHttpException(e);
      throw e;
    }
  }
}
