const mockPush = jest.fn();
const mockAddListener = jest.fn().mockReturnValue({ remove: jest.fn() });
let mockLastResponse: any = null;
let mockNavigationState: { key: string } | undefined = { key: 'root' };

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useRootNavigationState: () => mockNavigationState,
}));

jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: (cb: any) => mockAddListener(cb),
  useLastNotificationResponse: () => mockLastResponse,
}));

import { renderHook } from '@testing-library/react-native';
import { useNotificationNavigation } from './useNotificationNavigation';

function makeResponse(data: unknown) {
  return { notification: { request: { content: { data } } } } as any;
}

describe('useNotificationNavigation', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockAddListener.mockClear();
    mockLastResponse = null;
    mockNavigationState = { key: 'root' };
  });

  it('registers a foreground/background tap listener on mount', () => {
    renderHook(() => useNotificationNavigation());
    expect(mockAddListener).toHaveBeenCalledTimes(1);
  });

  it('navigates to the container detail screen for a valid containerId', () => {
    renderHook(() => useNotificationNavigation());
    const handler = mockAddListener.mock.calls[0][0];
    handler(makeResponse({ type: 'eta_changed', containerId: 'abc-123' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/container/[id]', params: { id: 'abc-123' } });
  });

  it('does nothing for a missing containerId', () => {
    renderHook(() => useNotificationNavigation());
    const handler = mockAddListener.mock.calls[0][0];
    handler(makeResponse({ type: 'eta_changed' }));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does nothing for a malformed (non-string) containerId', () => {
    renderHook(() => useNotificationNavigation());
    const handler = mockAddListener.mock.calls[0][0];
    handler(makeResponse({ containerId: 12345 }));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('navigates on cold start from useLastNotificationResponse', () => {
    mockLastResponse = makeResponse({ type: 'arrived', containerId: 'cold-start-id' });
    renderHook(() => useNotificationNavigation());
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/container/[id]', params: { id: 'cold-start-id' } });
  });

  it('defers cold-start navigation until the root navigator has mounted', () => {
    mockNavigationState = undefined;
    mockLastResponse = makeResponse({ type: 'arrived', containerId: 'cold-start-id' });
    const { rerender } = renderHook(() => useNotificationNavigation());
    expect(mockPush).not.toHaveBeenCalled();

    mockNavigationState = { key: 'root' };
    rerender({});
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/container/[id]', params: { id: 'cold-start-id' } });
  });
});
