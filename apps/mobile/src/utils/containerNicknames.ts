import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Device-local nicknames for containers — purely a personal label for the
 * one person using this app to tell containers apart at a glance. Never
 * sent to the backend: stored only in AsyncStorage on this device, keyed by
 * container id.
 */
const KEY_PREFIX = 'container_nickname:';

export async function getContainerNickname(containerId: string): Promise<string | null> {
  return AsyncStorage.getItem(KEY_PREFIX + containerId);
}

export async function setContainerNickname(containerId: string, nickname: string): Promise<void> {
  const trimmed = nickname.trim();
  if (!trimmed) {
    await AsyncStorage.removeItem(KEY_PREFIX + containerId);
    return;
  }
  await AsyncStorage.setItem(KEY_PREFIX + containerId, trimmed);
}
