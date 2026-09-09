import * as Device from 'expo-device';
import type * as NotificationsType from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { registerDevice } from '../api/devices';
import type { DevicePlatform } from '../api/types';
import { isPushNotificationsSupported } from './pushSupport';

/**
 * Requests notification permission (if not already granted or denied) and,
 * on success, registers the device's Expo push token with the Phase C
 * backend endpoint. Every failure mode here degrades gracefully — the app
 * has no login/settings screen to surface a retry action from, so this is
 * best-effort and silent by design (a console warning in dev only), never a
 * blocking or crashing path.
 *
 * Returns true if a token was obtained and registration succeeded.
 */
export async function registerForPushNotifications(): Promise<boolean> {
  // Checked FIRST, before ever requiring expo-notifications — see
  // pushSupport.ts: merely importing the package crashes on Android inside
  // Expo Go (remote push was removed there in SDK 53), so the `import type`
  // above (erased at compile time, never a runtime import) plus this
  // conditional `require` below are both load-bearing, not stylistic.
  if (!isPushNotificationsSupported()) {
    if (__DEV__) {
      console.warn(
        '[notifications] Skipping push registration — remote push is unavailable in Expo Go on Android (SDK 53+). Use a development build to test push.',
      );
    }
    return false;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Notifications = require('expo-notifications') as typeof NotificationsType;

  if (!Device.isDevice) {
    // Push tokens are not obtainable on simulators/emulators for iOS, and
    // are unreliable on Android emulators without Google Play services.
    if (__DEV__) console.warn('[notifications] Skipping push registration — not a physical device.');
    return false;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') {
    if (__DEV__) console.warn('[notifications] Permission not granted — push disabled for this session.');
    return false;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    // No EAS project has been linked yet (`eas init`). Expected during local
    // development; push simply stays inactive until that one-time setup is done.
    if (__DEV__) {
      console.warn('[notifications] No EAS projectId configured — cannot request an Expo push token yet.');
    }
    return false;
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const platform: DevicePlatform = Platform.OS === 'ios' ? 'ios' : 'android';
    await registerDevice({
      token,
      platform,
      appVersion: Constants.expoConfig?.version,
    });
    return true;
  } catch (err) {
    // Never let a registration failure (network down, backend unreachable,
    // 401 from a misconfigured secret) affect app startup or navigation.
    if (__DEV__) console.warn('[notifications] Registration failed:', err);
    return false;
  }
}
