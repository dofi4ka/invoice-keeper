import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

function errorMessage(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown })?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { msg?: string; loc?: string[] };
    return (first.msg ?? "Ошибка").replace(/^Value error, /, "");
  }
  if (status >= 500) return "Ошибка сервера, попробуйте позже";
  return "Не удалось выполнить запрос";
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (response.status === 204) return undefined as T;
  const body = response.headers.get("content-type")?.includes("json") ? await response.json() : null;
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/login")) onUnauthorized();
    throw new ApiError(response.status, errorMessage(body, response.status));
  }
  return body as T;
}

export function qs(params: Record<string, string | number | boolean | (string | number)[] | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) value.forEach((v) => search.append(key, String(v)));
    else search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

// --- a tiny query cache: components re-fetch when data they depend on is invalidated ---

let version = 0;
const listeners = new Set<() => void>();

/** Marks all cached data stale; mounted queries re-fetch in the background. */
export function invalidate() {
  version += 1;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const cache = new Map<string, unknown>();

export function useQuery<T>(path: string | null) {
  const v = useSyncExternalStore(subscribe, () => version);
  const [data, setData] = useState<T | undefined>(() => (path ? (cache.get(path) as T | undefined) : undefined));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path) {
      setData(undefined);
      return;
    }
    let alive = true;
    if (cache.has(path)) setData(cache.get(path) as T);
    setLoading(true);
    api<T>(path)
      .then((d) => {
        cache.set(path, d);
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, v]);

  const mutate = useCallback(
    (d: T) => {
      if (path) cache.set(path, d);
      setData(d);
    },
    [path],
  );

  return { data, error, loading, mutate };
}
