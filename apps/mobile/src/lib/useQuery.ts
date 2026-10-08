import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { api, describeError } from './api';

/**
 * Fetches when the screen gains focus (so data is fresh after navigating back)
 * and supports pull-to-refresh. Previous data stays visible while refetching,
 * which matters on slow connections.
 */
export function useQuery<T>(path: string | null) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(path);
  latest.current = path;

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!path) return;
      mode === 'refresh' ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        const result = await api<T>(path);
        if (latest.current === path) setData(result);
      } catch (e) {
        if (latest.current === path) setError(describeError(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [path],
  );

  useEffect(() => {
    setData(undefined);
  }, [path]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { data, error, loading: loading && data === undefined, refreshing, refresh: () => load('refresh'), reload: () => load() };
}
