import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { ClerkStrategy } from './clerk.strategy';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

jest.mock('jsonwebtoken');
jest.mock('jwks-rsa', () => ({
  JwksClient: jest.fn().mockImplementation(() => ({
    getSigningKey: jest.fn(),
  })),
}));

describe('ClerkStrategy', () => {
  let strategy: ClerkStrategy;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getSigningKeyMock: any;
  const mockConfigService = { get: fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfigService.get.mockReturnValue(undefined); // falls back to the default JWKS URL

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    strategy = new ClerkStrategy(mockConfigService as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getSigningKeyMock = (strategy as any).jwksClient.getSigningKey;
    getSigningKeyMock.mockResolvedValue({ getPublicKey: () => 'fake-public-key-pem' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (jwt.decode as any).mockReturnValue({ header: { kid: 'key-1' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (jwt.verify as any).mockReturnValue({ sub: 'user_123' });
  });

  // ---------------------------------------------------------------------
  // JWKS URL resolution
  // ---------------------------------------------------------------------

  it('falls back to the default Clerk JWKS URL when CLERK_JWKS_URL is unset', () => {
    expect(JwksClient).toHaveBeenCalledWith(
      expect.objectContaining({ jwksUri: 'https://api.clerk.com/v1/jwks' }),
    );
  });

  it('uses CLERK_JWKS_URL when configured', () => {
    mockConfigService.get.mockReturnValue('https://custom.clerk.instance/.well-known/jwks.json');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new ClerkStrategy(mockConfigService as any);

    expect(JwksClient).toHaveBeenCalledWith(
      expect.objectContaining({ jwksUri: 'https://custom.clerk.instance/.well-known/jwks.json' }),
    );
  });

  // ---------------------------------------------------------------------
  // Role-claim extraction — the three shapes ClerkUser.extractRole checks
  // ---------------------------------------------------------------------

  it('extracts the role from a top-level "role" claim', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (jwt.verify as any).mockReturnValue({ sub: 'user_123', role: 'owner' });

    await expect(strategy.verify('token')).resolves.toEqual({ userId: 'user_123', role: 'owner' });
  });

  it('falls back to publicMetadata.role when no top-level role claim is present', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (jwt.verify as any).mockReturnValue({ sub: 'user_123', publicMetadata: { role: 'accountant' } });

    await expect(strategy.verify('token')).resolves.toEqual({ userId: 'user_123', role: 'accountant' });
  });

  it('falls back to metadata.role when neither role nor publicMetadata.role is present', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (jwt.verify as any).mockReturnValue({ sub: 'user_123', metadata: { role: 'driver' } });

    await expect(strategy.verify('token')).resolves.toEqual({ userId: 'user_123', role: 'driver' });
  });

  it('returns role: undefined when no claim shape carries a role', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (jwt.verify as any).mockReturnValue({ sub: 'user_123' });

    await expect(strategy.verify('token')).resolves.toEqual({ userId: 'user_123', role: undefined });
  });

  // ---------------------------------------------------------------------
  // Failure paths — all must fail closed with UnauthorizedException
  // ---------------------------------------------------------------------

  it('rejects when the token cannot be decoded at all', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (jwt.decode as any).mockReturnValue(null);

    await expect(strategy.verify('not-a-jwt')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when jwt.decode returns a string instead of an object', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (jwt.decode as any).mockReturnValue('unexpected-string-result');

    await expect(strategy.verify('weird-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the decoded header has no "kid"', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (jwt.decode as any).mockReturnValue({ header: {} });

    await expect(strategy.verify('token-without-kid')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the JWKS signing key cannot be resolved', async () => {
    getSigningKeyMock.mockRejectedValue(new Error('key not found'));

    await expect(strategy.verify('token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when jwt.verify throws (invalid signature / expired token)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (jwt.verify as any).mockImplementation(() => {
      throw new Error('jwt expired');
    });

    await expect(strategy.verify('token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the verified payload has no "sub" claim', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (jwt.verify as any).mockReturnValue({ role: 'owner' });

    await expect(strategy.verify('token')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
