const mockRegisterDevice = jest.fn();
jest.mock('../api/devices', () => ({ registerDevice: (...args: any[]) => mockRegisterDevice(...args) }));

const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockGetToken = jest.fn();
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: () => mockGetPermissions(),
  requestPermissionsAsync: () => mockRequestPermissions(),
  getExpoPushTokenAsync: (...args: any[]) => mockGetToken(...args),
}));

let mockIsDevice = true;
jest.mock('expo-device', () => ({
  get isDevice() {
    return mockIsDevice;
  },
}));

let mockProjectId: string | undefined = 'test-project-id';
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: { eas: { projectId: mockProjectId } }, version: '1.0.0' };
    },
    easConfig: undefined,
  },
}));

let mockIsExpoGo = false;
jest.mock('expo', () => ({ isRunningInExpoGo: () => mockIsExpoGo }));

let mockPlatformOS: 'ios' | 'android' = 'ios';
jest.mock('react-native', () => ({ Platform: { get OS() { return mockPlatformOS; } } }));

import { registerForPushNotifications } from './registerForPushNotifications';

describe('registerForPushNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsDevice = true;
    mockProjectId = 'test-project-id';
    mockIsExpoGo = false;
    mockPlatformOS = 'ios';
    mockGetPermissions.mockResolvedValue({ status: 'granted' });
  });

  it('skips on a simulator/emulator', async () => {
    mockIsDevice = false;
    const result = await registerForPushNotifications();
    expect(result).toBe(false);
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('requests permission if not already granted', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'undetermined' });
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetToken.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
    mockRegisterDevice.mockResolvedValue({ id: '1', platform: 'ios', active: true });
    await registerForPushNotifications();
    expect(mockRequestPermissions).toHaveBeenCalled();
  });

  it('returns false when permission is denied, without requesting a token', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'denied' });
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });
    const result = await registerForPushNotifications();
    expect(result).toBe(false);
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('returns false when no EAS projectId is configured', async () => {
    mockProjectId = undefined;
    const result = await registerForPushNotifications();
    expect(result).toBe(false);
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('registers the device on success and never echoes the token in the call site logic', async () => {
    mockGetToken.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
    mockRegisterDevice.mockResolvedValue({ id: '1', platform: 'ios', active: true });
    const result = await registerForPushNotifications();
    expect(result).toBe(true);
    expect(mockRegisterDevice).toHaveBeenCalledWith({
      token: 'ExponentPushToken[abc]',
      platform: expect.any(String),
      appVersion: '1.0.0',
    });
  });

  it('degrades gracefully when registration fails (network/backend error)', async () => {
    mockGetToken.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
    mockRegisterDevice.mockRejectedValue({ status: 401, error: 'Unauthorized', code: 'UNAUTHORIZED' });
    const result = await registerForPushNotifications();
    expect(result).toBe(false);
  });

  // Expo Go on Android removed remote push in SDK 53 — expo-notifications'
  // getDevicePushTokenAsync() throws synchronously for this exact case, so
  // this must be short-circuited before ever calling it.
  it('skips push registration on Android inside Expo Go, without calling getExpoPushTokenAsync', async () => {
    mockPlatformOS = 'android';
    mockIsExpoGo = true;
    const result = await registerForPushNotifications();
    expect(result).toBe(false);
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockGetPermissions).not.toHaveBeenCalled();
  });

  it('does NOT skip on Android outside Expo Go (a real device build)', async () => {
    mockPlatformOS = 'android';
    mockIsExpoGo = false;
    mockGetToken.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
    mockRegisterDevice.mockResolvedValue({ id: '1', platform: 'android', active: true });
    const result = await registerForPushNotifications();
    expect(result).toBe(true);
  });

  it('does NOT skip on iOS inside Expo Go (only Android dropped remote push)', async () => {
    mockPlatformOS = 'ios';
    mockIsExpoGo = true;
    mockGetToken.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
    mockRegisterDevice.mockResolvedValue({ id: '1', platform: 'ios', active: true });
    const result = await registerForPushNotifications();
    expect(result).toBe(true);
  });
});
