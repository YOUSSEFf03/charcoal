const mockUseContainerDetail = jest.fn();
const mockUseTrackingEvents = jest.fn();
jest.mock('../../src/hooks/useContainerDetail', () => ({
  useContainerDetail: (...args: any[]) => mockUseContainerDetail(...args),
  useTrackingEvents: (...args: any[]) => mockUseTrackingEvents(...args),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'container-1' }),
  Stack: { Screen: () => null },
}));

import { render, screen } from '@testing-library/react-native';
import ContainerDetailScreen from '../../app/container/[id]';
import type { MobileContainer, MobileTrackingEvent } from '../../src/api/types';

const container: MobileContainer = {
  id: 'container-1',
  containerNumber: 'MSCU1234567',
  status: 'transit',
  arrivalDate: null,
  notes: 'Handle with care',
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
    isDelayed: true,
    isActive: true,
    providerUpdatedAt: null,
    lastFetchedAt: '2026-09-08T00:00:00.000Z',
  },
};

const events: MobileTrackingEvent[] = [
  { description: 'Departed origin port', location: 'Lagos', occurredAt: '2026-09-01T00:00:00.000Z' },
];

describe('ContainerDetailScreen', () => {
  beforeEach(() => {
    mockUseContainerDetail.mockReset();
    mockUseTrackingEvents.mockReset();
    mockUseTrackingEvents.mockReturnValue({ data: events, isLoading: false, error: null, refetch: jest.fn() });
  });

  it('shows a loading state while fetching', () => {
    mockUseContainerDetail.mockReturnValue({ isLoading: true, data: undefined, error: null });
    render(<ContainerDetailScreen />);
    expect(screen.getByText('Loading container…')).toBeTruthy();
  });

  it('shows a not-found state on 404', () => {
    mockUseContainerDetail.mockReturnValue({
      isLoading: false,
      data: undefined,
      error: { status: 404, error: 'Not found', code: 'NOT_FOUND' },
    });
    render(<ContainerDetailScreen />);
    expect(screen.getByText('Container not found')).toBeTruthy();
  });

  it('renders container identity, tracking fields, delay badge, and timeline', () => {
    mockUseContainerDetail.mockReturnValue({
      isLoading: false,
      isFetching: false,
      data: container,
      error: null,
      refetch: jest.fn(),
    });
    render(<ContainerDetailScreen />);
    expect(screen.getByText('MSCU1234567')).toBeTruthy();
    expect(screen.getByText(/Acme Charcoal/)).toBeTruthy();
    expect(screen.getByText('Delayed')).toBeTruthy();
    expect(screen.getByText('MV Test')).toBeTruthy();
    expect(screen.getByText('Departed origin port')).toBeTruthy();
  });

  it('shows a not-tracked message when tracking is null', () => {
    mockUseContainerDetail.mockReturnValue({
      isLoading: false,
      isFetching: false,
      data: { ...container, tracking: null },
      error: null,
      refetch: jest.fn(),
    });
    render(<ContainerDetailScreen />);
    expect(screen.getByText(/Not tracked yet/)).toBeTruthy();
  });
});
