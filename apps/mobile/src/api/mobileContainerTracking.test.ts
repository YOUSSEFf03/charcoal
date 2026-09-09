const mockGet = jest.fn();
jest.mock('./client', () => ({ api: { get: (...args: any[]) => mockGet(...args) } }));

import { listContainers, getContainer, getContainerEvents } from './mobileContainerTracking';

describe('mobileContainerTracking API functions', () => {
  beforeEach(() => mockGet.mockReset());

  it('listContainers calls the list endpoint with query params', async () => {
    mockGet.mockResolvedValue({ data: { data: [], total: 0, page: 1, limit: 20 } });
    await listContainers({ page: 2, limit: 10, status: 'port', search: 'MSCU' });
    expect(mockGet).toHaveBeenCalledWith('/mobile/container-tracking', {
      params: { page: 2, limit: 10, status: 'port', search: 'MSCU' },
    });
  });

  it('getContainer calls the detail endpoint by id', async () => {
    mockGet.mockResolvedValue({ data: { id: 'abc' } });
    await getContainer('abc');
    expect(mockGet).toHaveBeenCalledWith('/mobile/container-tracking/abc');
  });

  it('getContainerEvents calls the events endpoint by id', async () => {
    mockGet.mockResolvedValue({ data: [] });
    await getContainerEvents('abc');
    expect(mockGet).toHaveBeenCalledWith('/mobile/container-tracking/abc/events');
  });
});
