import { isPushNotificationsSupported } from './pushSupport';

/**
 * Show incoming notifications while the app is in the foreground (default
 * Expo behavior is to suppress them in foreground). Imported once, for its
 * side effect, from app/_layout.tsx before anything else renders.
 *
 * The require() is deliberately conditional and deliberately not a static
 * `import` — see pushSupport.ts's doc comment for why merely importing
 * expo-notifications crashes on Android inside Expo Go.
 */
if (isPushNotificationsSupported()) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Notifications = require('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}
