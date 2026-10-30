import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { TranslationProviderError } from './translation.provider';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

// Module-scope `mock`-prefixed vars — Jest's out-of-scope-variable
// restriction on jest.mock() factories explicitly exempts identifiers
// starting with "mock" (see ClerkStrategy's jwks-rsa mock, ../auth/clerk.strategy.spec.ts,
// this repo's existing precedent for mocking a constructed client class).
const mockTranslateText = fn();
const mockGetSupportedLanguages = fn();

jest.mock('@google-cloud/translate', () => ({
  TranslationServiceClient: jest.fn().mockImplementation(() => ({
    translateText: mockTranslateText,
    getSupportedLanguages: mockGetSupportedLanguages,
  })),
}));

import { GoogleTranslateProvider } from './google-translate.provider';

function configServiceStub(projectId: string = 'test-project'): ConfigService {
  return { get: () => projectId } as unknown as ConfigService;
}

// Deliberately a separate function, not configServiceStub(undefined) — a
// default parameter still applies when the argument is explicitly
// `undefined` (that's JS's actual default-parameter semantics), so
// configServiceStub(undefined) would silently fall back to 'test-project'
// instead of producing an unconfigured stub. This avoids that trap.
function unconfiguredConfigServiceStub(): ConfigService {
  return { get: () => undefined } as unknown as ConfigService;
}

/** A Google client error as thrown by google-gax — carries a numeric gRPC status `.code`. */
function grpcError(code: number, message = 'internal google detail'): Error & { code: number } {
  const e = new Error(message) as Error & { code: number };
  e.code = code;
  return e;
}

describe('GoogleTranslateProvider', () => {
  beforeEach(() => {
    mockTranslateText.mockReset();
    mockGetSupportedLanguages.mockReset();
  });

  describe('translate', () => {
    it('translates English to Arabic', async () => {
      mockTranslateText.mockResolvedValue([{ translations: [{ translatedText: 'مرحبا' }] }]);
      const provider = new GoogleTranslateProvider(configServiceStub());

      const result = await provider.translate('Hello', 'en', 'ar');

      expect(result).toEqual({ translatedText: 'مرحبا' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [request, options] = mockTranslateText.mock.calls[0] as [any, any];
      expect(request).toMatchObject({
        parent: 'projects/test-project/locations/global',
        contents: ['Hello'],
        mimeType: 'text/plain',
        sourceLanguageCode: 'en',
        targetLanguageCode: 'ar',
      });
      expect(options).toMatchObject({ timeout: 15000 });
    });

    it('translates Arabic to English', async () => {
      mockTranslateText.mockResolvedValue([{ translations: [{ translatedText: 'Hello' }] }]);
      const provider = new GoogleTranslateProvider(configServiceStub());

      const result = await provider.translate('مرحبا', 'ar', 'en');

      expect(result).toEqual({ translatedText: 'Hello' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [request] = mockTranslateText.mock.calls[0] as [any];
      expect(request).toMatchObject({ sourceLanguageCode: 'ar', targetLanguageCode: 'en' });
    });

    it('omits sourceLanguageCode entirely for source="auto" (Google auto-detects when absent)', async () => {
      mockTranslateText.mockResolvedValue([{ translations: [{ translatedText: 'x' }] }]);
      const provider = new GoogleTranslateProvider(configServiceStub());

      await provider.translate('a', 'auto', 'fr');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [request] = mockTranslateText.mock.calls[0] as [any];
      expect(request).not.toHaveProperty('sourceLanguageCode');
    });

    it('sends contents as an array, matching the client\'s batching-capable request shape', async () => {
      // The provider's own translate() always sends exactly one string —
      // that is this provider's whole contract. This just documents, at the
      // client-call level, that Google's request shape is an array (unlike
      // LibreTranslate's single-string `q`), should a future caller need
      // real multi-content batching.
      mockTranslateText.mockResolvedValue([{ translations: [{ translatedText: 'x' }] }]);
      const provider = new GoogleTranslateProvider(configServiceStub());

      await provider.translate('a', 'en', 'fr');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [request] = mockTranslateText.mock.calls[0] as [any];
      expect(Array.isArray(request.contents)).toBe(true);
      expect(request.contents).toEqual(['a']);
    });

    it('maps an empty translations array to invalid_response (empty provider response)', async () => {
      mockTranslateText.mockResolvedValue([{ translations: [] }]);
      const provider = new GoogleTranslateProvider(configServiceStub());

      await expect(provider.translate('a', 'en', 'fr')).rejects.toMatchObject({ kind: 'invalid_response' });
    });

    it('maps a response with an empty translatedText string to invalid_response (malformed response)', async () => {
      mockTranslateText.mockResolvedValue([{ translations: [{ translatedText: '' }] }]);
      const provider = new GoogleTranslateProvider(configServiceStub());

      await expect(provider.translate('a', 'en', 'fr')).rejects.toMatchObject({ kind: 'invalid_response' });
    });

    it('maps a response missing translations entirely to invalid_response', async () => {
      mockTranslateText.mockResolvedValue([{}]);
      const provider = new GoogleTranslateProvider(configServiceStub());

      await expect(provider.translate('a', 'en', 'fr')).rejects.toMatchObject({ kind: 'invalid_response' });
    });

    it('maps INVALID_ARGUMENT (3) to bad_request', async () => {
      mockTranslateText.mockRejectedValue(grpcError(3, 'Invalid language code: zz'));
      const provider = new GoogleTranslateProvider(configServiceStub());

      await expect(provider.translate('a', 'en', 'zz')).rejects.toBeInstanceOf(TranslationProviderError);
      await expect(provider.translate('a', 'en', 'zz')).rejects.toMatchObject({ kind: 'bad_request' });
    });

    it('maps UNAUTHENTICATED (16) to forbidden — authentication failure', async () => {
      mockTranslateText.mockRejectedValue(grpcError(16, 'Request had invalid authentication credentials'));
      const provider = new GoogleTranslateProvider(configServiceStub());

      await expect(provider.translate('a', 'en', 'fr')).rejects.toMatchObject({ kind: 'forbidden' });
    });

    it('maps PERMISSION_DENIED (7) to forbidden — permission denied', async () => {
      mockTranslateText.mockRejectedValue(
        grpcError(7, 'Cloud Translation API has not been used in project 123 before or it is disabled'),
      );
      const provider = new GoogleTranslateProvider(configServiceStub());

      await expect(provider.translate('a', 'en', 'fr')).rejects.toMatchObject({ kind: 'forbidden' });
    });

    it('maps RESOURCE_EXHAUSTED (8) to rate_limited — quota/rate limit', async () => {
      mockTranslateText.mockRejectedValue(grpcError(8, 'Quota exceeded for quota metric'));
      const provider = new GoogleTranslateProvider(configServiceStub());

      await expect(provider.translate('a', 'en', 'fr')).rejects.toMatchObject({ kind: 'rate_limited' });
    });

    it('maps UNAVAILABLE (14) to network_error — provider unavailable', async () => {
      mockTranslateText.mockRejectedValue(grpcError(14, 'The service is currently unavailable'));
      const provider = new GoogleTranslateProvider(configServiceStub());

      await expect(provider.translate('a', 'en', 'fr')).rejects.toMatchObject({ kind: 'network_error' });
    });

    it('maps DEADLINE_EXCEEDED (4) to network_error — timeout', async () => {
      mockTranslateText.mockRejectedValue(grpcError(4, 'Deadline exceeded'));
      const provider = new GoogleTranslateProvider(configServiceStub());

      await expect(provider.translate('a', 'en', 'fr')).rejects.toMatchObject({ kind: 'network_error' });
    });

    it('maps a plain network exception with no .code (e.g. DNS/connect failure) to upstream_error', async () => {
      mockTranslateText.mockRejectedValue(new Error('getaddrinfo ENOTFOUND translate.googleapis.com'));
      const provider = new GoogleTranslateProvider(configServiceStub());

      await expect(provider.translate('a', 'en', 'fr')).rejects.toMatchObject({ kind: 'upstream_error' });
    });

    it('maps an unrecognized gRPC code to upstream_error', async () => {
      mockTranslateText.mockRejectedValue(grpcError(13, 'Internal error'));
      const provider = new GoogleTranslateProvider(configServiceStub());

      await expect(provider.translate('a', 'en', 'fr')).rejects.toMatchObject({ kind: 'upstream_error' });
    });

    it('rejects with forbidden and makes no client call when GOOGLE_CLOUD_PROJECT_ID is unset — credential/configuration failure', async () => {
      const provider = new GoogleTranslateProvider(unconfiguredConfigServiceStub());

      await expect(provider.translate('a', 'en', 'fr')).rejects.toBeInstanceOf(TranslationProviderError);
      await expect(provider.translate('a', 'en', 'fr')).rejects.toMatchObject({ kind: 'forbidden' });
      expect(mockTranslateText).not.toHaveBeenCalled();
    });

    it('never includes the raw Google error message, project ID, or credential detail in the thrown error', async () => {
      mockTranslateText.mockRejectedValue(
        grpcError(16, 'invalid_grant: secret-token-abc123 rejected for projects/super-secret-project-id'),
      );
      const provider = new GoogleTranslateProvider(configServiceStub('super-secret-project-id'));

      await expect(provider.translate('a', 'en', 'fr')).rejects.not.toMatchObject({
        message: expect.stringContaining('secret-token-abc123'),
      });
      await expect(provider.translate('a', 'en', 'fr')).rejects.not.toMatchObject({
        message: expect.stringContaining('super-secret-project-id'),
      });
    });
  });

  describe('listLanguages', () => {
    it('GETs supported languages and derives targets as every other supported code', async () => {
      mockGetSupportedLanguages.mockResolvedValue([
        {
          languages: [
            { languageCode: 'en', displayName: 'English' },
            { languageCode: 'ar', displayName: 'Arabic' },
            { languageCode: 'fr', displayName: 'French' },
          ],
        },
      ]);
      const provider = new GoogleTranslateProvider(configServiceStub());

      const result = await provider.listLanguages();

      expect(result).toEqual([
        { code: 'en', name: 'English', targets: ['ar', 'fr'] },
        { code: 'ar', name: 'Arabic', targets: ['en', 'fr'] },
        { code: 'fr', name: 'French', targets: ['en', 'ar'] },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [request] = mockGetSupportedLanguages.mock.calls[0] as [any];
      expect(request).toMatchObject({ parent: 'projects/test-project/locations/global' });
    });

    it('maps a missing languages array to invalid_response', async () => {
      mockGetSupportedLanguages.mockResolvedValue([{}]);
      const provider = new GoogleTranslateProvider(configServiceStub());

      await expect(provider.listLanguages()).rejects.toMatchObject({ kind: 'invalid_response' });
    });

    it('drops entries missing a languageCode', async () => {
      mockGetSupportedLanguages.mockResolvedValue([
        { languages: [{ languageCode: 'en', displayName: 'English' }, { displayName: 'no code' }] },
      ]);
      const provider = new GoogleTranslateProvider(configServiceStub());

      const result = await provider.listLanguages();

      expect(result).toEqual([{ code: 'en', name: 'English', targets: [] }]);
    });

    it('rejects with forbidden and makes no client call when unconfigured', async () => {
      const provider = new GoogleTranslateProvider(unconfiguredConfigServiceStub());

      await expect(provider.listLanguages()).rejects.toMatchObject({ kind: 'forbidden' });
      expect(mockGetSupportedLanguages).not.toHaveBeenCalled();
    });

    it('maps a provider failure the same way translate() does', async () => {
      mockGetSupportedLanguages.mockRejectedValue(grpcError(14, 'unavailable'));
      const provider = new GoogleTranslateProvider(configServiceStub());

      await expect(provider.listLanguages()).rejects.toMatchObject({ kind: 'network_error' });
    });
  });
});
