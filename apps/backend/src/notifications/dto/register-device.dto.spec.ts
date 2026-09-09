import { describe, it, expect } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDeviceDto } from './register-device.dto';

describe('RegisterDeviceDto validation', () => {
  const valid = {
    token: 'ExponentPushToken[abcDEF123_-xyz]',
    platform: 'ios',
  };

  it('passes with a well-formed body', async () => {
    const dto = plainToInstance(RegisterDeviceDto, valid);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('passes with the ExpoPushToken[...] form too', async () => {
    const dto = plainToInstance(RegisterDeviceDto, { ...valid, token: 'ExpoPushToken[abc123]' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('passes with an optional appVersion', async () => {
    const dto = plainToInstance(RegisterDeviceDto, { ...valid, appVersion: '1.2.3' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a malformed/garbage token', async () => {
    const dto = plainToInstance(RegisterDeviceDto, { ...valid, token: 'not-a-real-token' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('token');
  });

  it('rejects a missing token', async () => {
    const dto = plainToInstance(RegisterDeviceDto, { platform: 'ios' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('token');
  });

  it('rejects an invalid platform', async () => {
    const dto = plainToInstance(RegisterDeviceDto, { ...valid, platform: 'windows-phone' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('platform');
  });

  it('rejects an overlong appVersion', async () => {
    const dto = plainToInstance(RegisterDeviceDto, { ...valid, appVersion: 'x'.repeat(60) });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('appVersion');
  });
});
