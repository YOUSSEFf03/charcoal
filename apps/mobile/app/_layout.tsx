import '../src/notifications/handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useDeviceRegistration } from '../src/hooks/useDeviceRegistration';
import { useNotificationNavigation } from '../src/notifications/useNotificationNavigation';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

export default function RootLayout() {
  useDeviceRegistration();
  useNotificationNavigation();

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#FFFFFF' },
            headerTitleStyle: { fontWeight: '700' },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="container/[id]" options={{ title: 'Container' }} />
        </Stack>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
