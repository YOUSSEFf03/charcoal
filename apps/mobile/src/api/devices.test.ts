const mockPost = jest.fn();
jest.mock('./client', () => ({ api: { post: (...args: any[]) => mockPost(...args) } }));

import { registerDevice } from './devices';

describe('registerDevice', () => {
  it('posts the device token to the registration endpoint', async () => {
    mockPost.mockResolvedValue({ data: { id: '1', platform: 'ios', active: true } });
    const res = await registerDevice({ token: 'ExponentPushToken[abc]', platform: 'ios', appVersion: '1.0.0' });
    expect(mockPost).toHaveBeenCalledWith('/mobile/devices', {
      token: 'ExponentPushToken[abc]',
      platform: 'ios',
      appVersion: '1.0.0',
    });
    expect(res).toEqual({ id: '1', platform: 'ios', active: true });
  });
});
