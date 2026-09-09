import { useEffect } from 'react';
import { registerForPushNotifications } from '../notifications/registerForPushNotifications';

/**
 * Fires once per app launch. There is no login/settings screen to trigger
 * this manually from, so app startup is the only hook point — matching the
 * product decision that push setup requires zero user interaction beyond
 * the OS permission prompt itself.
 */
export function useDeviceRegistration() {
  useEffect(() => {
    registerForPushNotifications();
  }, []);
}
