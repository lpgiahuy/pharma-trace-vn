'use client';

import { useCallback, useEffect, useState } from 'react';
import { workflowErrorMessage } from '@/utils/workflow-error';

export function useReport<T>(load: () => Promise<T>, enabled: boolean) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled || !enabled) return;
      setLoading(true);
      setError(null);
      try {
        const response = await load();
        if (!cancelled) setData(response);
      } catch (err) {
        if (!cancelled) setError(workflowErrorMessage(err, 'Could not load this report'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [load, enabled, revision]);

  return { data, error, loading, reload };
}
