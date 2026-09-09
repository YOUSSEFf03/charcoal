const mockUseContainers = jest.fn();
jest.mock('../src/hooks/useContainers', () => ({ useContainers: (...args: any[]) => mockUseContainers(...args) }));

jest.mock('expo-router', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Link: ({ children }: any) => children,
    useRouter: () => ({ push: jest.fn() }),
  };
});

import { act, render, screen } from '@testing-library/react-native';
import ContainerListScreen from '../app/index';
import type { MobileContainer } from '../src/api/types';

function renderScreen() {
  return render(<ContainerListScreen />);
}

function makeContainer(overrides: Partial<MobileContainer> = {}): MobileContainer {
  return {
    id: '1',
    containerNumber: 'MSCU1234567',
    status: 'transit',
    arrivalDate: null,
    notes: null,
    supplier: { name: 'Acme Charcoal', country: 'Nigeria' },
    sealineName: 'Maersk',
    tracking: {
      status: 'IN_TRANSIT',
      origin: 'Lagos',
      destination: 'Beirut',
      vessel: 'MV Test',
      voyage: '001W',
      currentLocation: 'At sea',
      eta: '2026-09-15T00:00:00.000Z',
      isDelayed: false,
      isActive: true,
      providerUpdatedAt: null,
      lastFetchedAt: '2026-09-08T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('ContainerListScreen', () => {
  beforeEach(() => {
    // Excluding setImmediate: RNTL's auto-cleanup awaits a setImmediate-based
    // flush after every test, and modern fake timers fake that too — without
    // this exclusion, cleanup deadlocks waiting on a timer only this file's
    // own (already-passed) afterEach would ever advance.
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    mockUseContainers.mockReset();
  });

  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  it('shows a loading state initially', () => {
    mockUseContainers.mockReturnValue({ isLoading: true, isFetching: true, data: undefined, error: null });
    renderScreen();
    expect(screen.getByText('Loading containers…')).toBeTruthy();
  });

  it('renders containers once loaded', () => {
    mockUseContainers.mockReturnValue({
      isLoading: false,
      isFetching: false,
      data: { data: [makeContainer()], total: 1, page: 1, limit: 20 },
      error: null,
      refetch: jest.fn(),
    });
    renderScreen();
    expect(screen.getByText('MSCU1234567')).toBeTruthy();
    expect(screen.getByText('Maersk · IN_TRANSIT')).toBeTruthy();
  });

  it('shows an empty state when there are no results', () => {
    mockUseContainers.mockReturnValue({
      isLoading: false,
      isFetching: false,
      data: { data: [], total: 0, page: 1, limit: 20 },
      error: null,
      refetch: jest.fn(),
    });
    renderScreen();
    expect(screen.getByText('No containers in transit.')).toBeTruthy();
  });

  it('shows an error state when the request fails and no cached items exist', () => {
    mockUseContainers.mockReturnValue({
      isLoading: false,
      isFetching: false,
      data: undefined,
      error: { status: undefined, error: 'Network error', code: 'NETWORK_ERROR' },
      refetch: jest.fn(),
    });
    renderScreen();
    expect(screen.getByText("Couldn't load containers")).toBeTruthy();
  });

  it('always queries with the transit status — no filter selection on this screen', () => {
    mockUseContainers.mockReturnValue({
      isLoading: false,
      isFetching: false,
      data: { data: [makeContainer()], total: 1, page: 1, limit: 20 },
      error: null,
      refetch: jest.fn(),
    });
    renderScreen();
    const lastCallArgs = mockUseContainers.mock.calls[mockUseContainers.mock.calls.length - 1][0];
    expect(lastCallArgs.status).toBe('transit');
  });
});
