import { describe, it, expect } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TranslateDto } from './translate.dto';

describe('TranslateDto validation', () => {
  it('passes with well-formed q/source/target', async () => {
    const dto = plainToInstance(TranslateDto, { q: 'Hello', source: 'en', target: 'ar' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('passes with source="auto"', async () => {
    const dto = plainToInstance(TranslateDto, { q: 'Hello', source: 'auto', target: 'ar' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('passes with a hyphenated regional code (e.g. pt-BR)', async () => {
    const dto = plainToInstance(TranslateDto, { q: 'Hello', source: 'en', target: 'pt-BR' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects empty text', async () => {
    const dto = plainToInstance(TranslateDto, { q: '', source: 'en', target: 'ar' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('q');
  });

  it('rejects missing text', async () => {
    const dto = plainToInstance(TranslateDto, { source: 'en', target: 'ar' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('q');
  });

  it('rejects text over 5000 characters', async () => {
    const dto = plainToInstance(TranslateDto, { q: 'a'.repeat(5001), source: 'en', target: 'ar' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('q');
  });

  it('rejects an obviously malformed source language code', async () => {
    const dto = plainToInstance(TranslateDto, { q: 'Hello', source: 'not-a-lang-code-at-all', target: 'ar' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('source');
  });

  it('rejects an obviously malformed target language code', async () => {
    const dto = plainToInstance(TranslateDto, { q: 'Hello', source: 'en', target: '???' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('target');
  });

  it('rejects an empty target', async () => {
    const dto = plainToInstance(TranslateDto, { q: 'Hello', source: 'en', target: '' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('target');
  });

  it('rejects a URL as the target language (SSRF-shaped input must not slip through as a "language code")', async () => {
    const dto = plainToInstance(TranslateDto, { q: 'Hello', source: 'en', target: 'http://evil.example.com' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('target');
  });
});
