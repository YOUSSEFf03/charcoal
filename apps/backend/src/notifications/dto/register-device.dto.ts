import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { DevicePlatform } from '@prisma/client';

// Expo push tokens look like "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" or
// the newer "ExpoPushToken[...]" form. Validated so a malformed/garbage
// value is rejected at the boundary rather than silently stored and only
// discovered as a permanent Expo delivery failure later.
const EXPO_PUSH_TOKEN_PATTERN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

export class RegisterDeviceDto {
  @IsString()
  @Length(1, 200)
  @Matches(EXPO_PUSH_TOKEN_PATTERN, { message: 'token must be a valid Expo push token' })
  token: string;

  @IsEnum(DevicePlatform)
  platform: DevicePlatform;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  appVersion?: string;
}
