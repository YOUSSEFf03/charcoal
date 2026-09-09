import { useEffect, useRef } from 'react';
import type * as NotificationsType from 'expo-notifications';
import { useRootNavigationState, useRouter } from 'expo-router';
import { isPushNotificationsSupported } from './pushSupport';

/**
 * Real module when safe to import, or an inert stand-in otherwise — see
 * pushSupport.ts. Resolved once at module scope (not per-render) so this
 * hook's own call shape below never has to branch: it always calls exactly
 * the same functions, real or no-op, keeping React's hook-call order
 * identical regardless of platform/environment. Module-scope-once is
 * correct here (unlike a function call) since Platform.OS/Expo-Go-ness are
 * genuinely fixed for the lifetime of a running app.
 */
const Notifications: Pick<
  typeof NotificationsType,
  'useLastNotificationResponse' | 'addNotificationResponseReceivedListener'
> = isPushNotificationsSupported()
  ? // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('expo-notifications')
  : {
      useLastNotificationResponse: () => null,
      addNotificationResponseReceivedListener: () => ({ remove: () => {} }) as any,
    };

/**
 * Navigates to the container detail screen when a push notification is
 * tapped — both while the app is running (foreground/background) and on a
 * cold start from a killed state (`useLastNotificationResponse`). The
 * payload shape is Phase C's `ContainerNotificationData`
 * (`{ type: 'eta_changed' | 'arrived', containerId }`), but this only ever
 * trusts `containerId`: a malformed or missing one is dropped silently
 * rather than navigating somewhere broken or throwing at startup.
 *
 * On Android inside Expo Go (see pushSupport.ts), this is a permanent no-op:
 * there is no notification machinery to listen to at all in that
 * environment, so it never navigates — never a crash, just nothing to do.
 */
export function useNotificationNavigation() {
  const router = useRouter();
  // The root Stack mounts its navigator asynchronously; navigating before
  // `key` is set throws "Attempted to navigate before mounting the Root
  // Layout". A cold-start tap can arrive before that happens, so it waits.
  const navigationState = useRootNavigationState();
  const handledColdStart = useRef(false);
  const lastResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      navigateFromResponse(response);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!lastResponse || handledColdStart.current || !navigationState?.key) return;
    handledColdStart.current = true;
    navigateFromResponse(lastResponse);
  }, [lastResponse, navigationState?.key]);

  function navigateFromResponse(response: NotificationsType.NotificationResponse) {
    const containerId = response.notification.request.content.data?.containerId;
    if (typeof containerId !== 'string' || containerId.length === 0) return;
    router.push({ pathname: '/container/[id]', params: { id: containerId } });
  }
}
