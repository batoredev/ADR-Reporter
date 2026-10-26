"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiGet } from "./client";

const REFRESH_EVENT = "adr:refresh";

/** Reloads the data shown on the page, for example after an action changed it. */
export function refreshData() {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

export interface ApiState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
}

/** Loads `path` from the API, and again whenever refreshData() is called. A null path loads nothing. */
export function useApi<T>(path: string | null): ApiState<T> & { reload: () => void } {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ key: string; path: string; data?: T; error?: ApiError } | null>(null);
  const key = path === null ? null : `${path}#${version}`;
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    window.addEventListener(REFRESH_EVENT, reload);
    return () => window.removeEventListener(REFRESH_EVENT, reload);
  }, [reload]);

  useEffect(() => {
    if (key === null || path === null) return;
    let cancelled = false;
    apiGet<T>(path).then(
      (data) => !cancelled && setResult({ key, path, data }),
      (error: unknown) =>
        !cancelled &&
        setResult({
          key,
          path,
          error: error instanceof ApiError ? error : new ApiError("Something went wrong.", 0),
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [key, path]);

  const current = result?.key === key ? result : null;
  // While reloading the same path, keep showing the previous data rather than a blank page.
  const data = current ? current.data : result?.path === path ? result?.data : undefined;
  return { data, error: current?.error, loading: !current, reload };
}
