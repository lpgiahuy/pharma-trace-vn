'use client';

import { useCallback, useEffect, useState } from 'react';
import { workflowErrorMessage } from '@/utils/workflow-error';

/** Loads one dashboard widget; refetches whenever `load` changes and keeps only the latest response. */
export function useReport<T>(load: () => Promise<T>, enabled = true) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
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

  return { data, error, loading: enabled && loading, reload };
}
