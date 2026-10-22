"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    method: rest.method ?? (json !== undefined ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {}
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const post = <T,>(path: string, json: unknown = {}) => api<T>(path, { json });

const cache = new Map<string, unknown>();

/** Fetches `path`, keeps the previous value while refetching, refetches when `version` changes. */
export function useApi<T>(path: string | null, version: unknown = 0) {
  const [data, setData] = useState<T | undefined>(() => (path ? (cache.get(path) as T | undefined) : undefined));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const s = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (s === seq.current) {
        cache.set(path, d);
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (s === seq.current) setError((e as Error).message);
    } finally {
      if (s === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    if (path && cache.has(path)) setData(cache.get(path) as T);
    load();
  }, [load, version, path]);
  return { data, error, loading, reload: load };
}
