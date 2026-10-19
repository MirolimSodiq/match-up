import { useCallback, useState } from 'react';

/**
 * Faqat foydalanuvchi tortib yangilaganda spinner: `isRefetching` fon polling'ida ham `true` bo'ladi
 * (takliflar har 20 s yangilanadi) — u holda ro'yxat tepasida spinner miltillab turardi.
 */
export function usePullRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);
  return { refreshing, onRefresh: () => void onRefresh() };
}
