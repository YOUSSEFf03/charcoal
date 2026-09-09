/**
 * Real-Google-Cloud-Translation integration test — requires a real,
 * configured GOOGLE_CLOUD_PROJECT_ID (+ credentials resolvable via
 * Application Default Credentials — see GoogleTranslateProvider's doc
 * comment) in the environment this runs under, same precondition shape as
 * test/traqo-multi-account.integration-spec.ts (which needs a real
 * TRAQO_API_KEY). NOT part of `npm test` (that suite is 100% mocked-
 * provider — see google-translate.provider.spec.ts / translation.service.spec.ts)
 * — run explicitly via `npm run test:integration`, same convention as every
 * other apps/backend/test/*.integration-spec.ts file.
 *
 * ADDITIONAL gate beyond that existing convention: this file also requires
 * GOOGLE_TRANSLATE_LIVE_TEST=true to be set, and is entirely skipped
 * (describe.skip) otherwise — even under `npm run test:integration`. This
 * repo's audit found no existing per-test opt-in-env-var precedent (Traqo's
 * equivalent integration test has none), but Google Cloud Translation calls
 * can incur real billing, unlike free/self-hosted LibreTranslate or Traqo's
 * already-provisioned test account — so requiring an explicit, additional
 * "yes, really call the paid API" flag (mirroring DEV_AUTH_BYPASS_ENABLED's
 * existing "explicit boolean gate for a sensitive capability" pattern in
 * env.validation.ts) is a deliberate, minimal safety margin beyond what the
 * rest of this repo's integration tests do, not an invented new convention
 * applied everywhere.
 *
 * Why this exists: the provider/service unit tests mock the
 * @google-cloud/translate client entirely, so they can never catch a real
 * drift between Google's actual current API contract and what
 * GoogleTranslateProvider assumes. Only a test that talks to the real
 * Google Cloud Translation API can catch that class of regression.
 *
 * Uses TranslationService wired to the real GoogleTranslateProvider (via
 * TranslationModule) — no HTTP layer, no auth guards, same shape as
 * stock-cogs.integration-spec.ts's "real NestJS services, no HTTP layer"
 * approach.
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { TranslationModule } from '../src/translation/translation.module';
import { TranslationService } from '../src/translation/translation.service';

const LIVE = process.env.GOOGLE_TRANSLATE_LIVE_TEST === 'true';
const describeIfLive = LIVE ? describe : describe.skip;

describeIfLive('Translation — real Google Cloud Translation integration', () => {
  let service: TranslationService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), TranslationModule],
    }).compile();
    service = moduleRef.get(TranslationService);
  });

  it('lists supported languages and includes English and Arabic', async () => {
    const languages = await service.listLanguages();
    const codes = languages.map((l) => l.code);
    expect(codes).toEqual(expect.arrayContaining(['en', 'ar']));
  });

  it('translates English to Arabic through the real Google Cloud Translation API', async () => {
    const result = await service.translate('Hello, how are you?', 'en', 'ar');
    expect(typeof result.translatedText).toBe('string');
    expect(result.translatedText.length).toBeGreaterThan(0);
    // Real MT output isn't a fixed string we can pin exactly, but it must
    // actually be Arabic script, not an English passthrough/error string.
    expect(result.translatedText).toMatch(/[؀-ۿ]/);
  });

  it('translates Arabic to English through the real Google Cloud Translation API', async () => {
    const result = await service.translate('أجود أنواع الفحم', 'ar', 'en');
    expect(typeof result.translatedText).toBe('string');
    expect(result.translatedText.length).toBeGreaterThan(0);
    // Must not still be Arabic script — a real EN translation happened.
    expect(result.translatedText).not.toMatch(/[؀-ۿ]/);
  });

  it('rejects an unsupported target language with a clean business error, not a raw provider leak', async () => {
    try {
      await service.translate('Hello', 'en', 'zz');
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      const ex = e as HttpException;
      const body = ex.getResponse() as { error: string; code: string };
      // Whichever kind Google's real rejection maps to (bad_request or
      // upstream_error, depending on how the API rejects an invalid code),
      // it must be our own fixed business copy, never Google's raw error text.
      expect(body.error).not.toMatch(/google|grpc|permission|credential/i);
      expect(body.code).toMatch(/^TRANSLATION_/);
    }
  });
});
