import { describe, it, expect, jest } from '@jest/globals';
import { HttpException, HttpStatus } from '@nestjs/common';
import { TranslationService } from './translation.service';
import { TranslationProvider, TranslationProviderError } from './translation.provider';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

function providerStub(overrides: { translate?: any; listLanguages?: any } = {}): TranslationProvider { // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    translate: fn(),
    listLanguages: fn(),
    ...overrides,
  };
}

type TranslationErrorKindCase =
  | 'network_error'
  | 'bad_request'
  | 'rate_limited'
  | 'forbidden'
  | 'invalid_response'
  | 'upstream_error';

describe('TranslationService', () => {
  describe('translate', () => {
    it('returns the provider result unchanged on success', async () => {
      const translate = fn();
      translate.mockResolvedValue({ translatedText: 'Bonjour' });
      const provider = providerStub({ translate });
      const service = new TranslationService(provider);

      const result = await service.translate('Hello', 'en', 'fr');

      expect(result).toEqual({ translatedText: 'Bonjour' });
      expect(provider.translate).toHaveBeenCalledWith('Hello', 'en', 'fr');
    });

    it('translates Arabic to English through the provider', async () => {
      const translate = fn();
      translate.mockResolvedValue({ translatedText: 'Hello' });
      const provider = providerStub({ translate });
      const service = new TranslationService(provider);

      const result = await service.translate('مرحبا', 'ar', 'en');

      expect(result).toEqual({ translatedText: 'Hello' });
    });

    it('translates English to Arabic through the provider', async () => {
      const translate = fn();
      translate.mockResolvedValue({ translatedText: 'مرحبا' });
      const provider = providerStub({ translate });
      const service = new TranslationService(provider);

      const result = await service.translate('Hello', 'en', 'ar');

      expect(result).toEqual({ translatedText: 'مرحبا' });
    });

    const cases: Array<[TranslationErrorKindCase, HttpStatus]> = [
      ['network_error', HttpStatus.SERVICE_UNAVAILABLE],
      ['bad_request', HttpStatus.BAD_REQUEST],
      ['rate_limited', HttpStatus.TOO_MANY_REQUESTS],
      ['forbidden', HttpStatus.BAD_GATEWAY],
      ['invalid_response', HttpStatus.BAD_GATEWAY],
      ['upstream_error', HttpStatus.BAD_GATEWAY],
    ];

    for (const [kind, status] of cases) {
      it(`converts a TranslationProviderError(${kind}) into an HttpException with status ${status}`, async () => {
        const translate = fn();
        translate.mockRejectedValue(new TranslationProviderError(kind, 'raw internal detail'));
        const provider = providerStub({ translate });
        const service = new TranslationService(provider);

        try {
          await service.translate('a', 'en', 'fr');
          throw new Error('expected to throw');
        } catch (e) {
          expect(e).toBeInstanceOf(HttpException);
          const ex = e as HttpException;
          expect(ex.getStatus()).toBe(status);
          const body = ex.getResponse() as { error: string; code: string };
          expect(body.code).toBe(`TRANSLATION_${kind.toUpperCase()}`);
          // Never the raw provider-supplied message.
          expect(body.error).not.toContain('raw internal detail');
        }
      });
    }

    it('propagates a non-TranslationProviderError unchanged (no false business-error masking)', async () => {
      const boom = new Error('unexpected bug');
      const translate = fn();
      translate.mockRejectedValue(boom);
      const provider = providerStub({ translate });
      const service = new TranslationService(provider);

      await expect(service.translate('a', 'en', 'fr')).rejects.toBe(boom);
    });

    it('carries retryAfterSeconds through to the HttpException details when present', async () => {
      const translate = fn();
      translate.mockRejectedValue(new TranslationProviderError('rate_limited', 'x', 30));
      const provider = providerStub({ translate });
      const service = new TranslationService(provider);

      try {
        await service.translate('a', 'en', 'fr');
        throw new Error('expected to throw');
      } catch (e) {
        const body = (e as HttpException).getResponse() as { details?: { retryAfterSeconds?: number } };
        expect(body.details?.retryAfterSeconds).toBe(30);
      }
    });
  });

  describe('listLanguages', () => {
    it('returns the provider result unchanged on success', async () => {
      const languages = [{ code: 'en', name: 'English', targets: ['ar'] }];
      const listLanguages = fn();
      listLanguages.mockResolvedValue(languages);
      const provider = providerStub({ listLanguages });
      const service = new TranslationService(provider);

      const result = await service.listLanguages();

      expect(result).toEqual(languages);
    });

    it('converts a provider failure into a clean HttpException', async () => {
      const listLanguages = fn();
      listLanguages.mockRejectedValue(new TranslationProviderError('network_error', 'x'));
      const provider = providerStub({ listLanguages });
      const service = new TranslationService(provider);

      await expect(service.listLanguages()).rejects.toBeInstanceOf(HttpException);
    });
  });
});
