import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

/**
 * Whether `expo-notifications` can be safely IMPORTED at all, not just
 * called. The package has an internal auto-registration side effect
 * (DevicePushTokenAutoRegistration.fx, wired up from index.js's top-level
 * re-export of getExpoPushTokenAsync) that runs the instant the module is
 * required — and that side effect itself throws synchronously on Android
 * inside Expo Go, where remote push was removed entirely in SDK 53. A plain
 * top-level `import * as Notifications from 'expo-notifications'` therefore
 * crashes app startup on that one platform/environment combination
 * regardless of which API you actually intended to call.
 *
 * Every file that touches expo-notifications must check this BEFORE
 * requiring the package (a conditional `require`, never a static import),
 * and fall back to inert stand-ins when it's false. iOS Expo Go and any
 * real device build (dev client or standalone) on either platform are
 * unaffected.
 *
 * A function, not a cached constant: Platform.OS and isRunningInExpoGo()
 * never actually change during a real app's lifetime, so calling this fresh
 * each time costs nothing — and it keeps the check testable per call site
 * instead of being frozen at whatever the first module import happened to see.
 */
export function isPushNotificationsSupported(): boolean {
  return !(Platform.OS === 'android' && isRunningInExpoGo());
}
