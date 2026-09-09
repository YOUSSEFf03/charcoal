import { useCallback, useEffect, useState } from 'react';
import { getContainerNickname, setContainerNickname } from '../utils/containerNicknames';

export function useContainerNickname(containerId: string) {
  const [nickname, setNicknameState] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getContainerNickname(containerId).then((value) => {
      if (!cancelled) setNicknameState(value);
    });
    return () => {
      cancelled = true;
    };
  }, [containerId]);

  const save = useCallback(
    async (value: string) => {
      await setContainerNickname(containerId, value);
      setNicknameState(value.trim() || null);
    },
    [containerId],
  );

  return { nickname, setNickname: save };
}
