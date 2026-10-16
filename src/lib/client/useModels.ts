"use client";

import { useEffect, useState } from "react";
import type { Capability, ModelsResponse } from "@/lib/types";

// One request per capability per page load, shared by every component.
const cache = new Map<string, Promise<ModelsResponse>>();

function load(capability: Capability | "all"): Promise<ModelsResponse> {
  let promise = cache.get(capability);
  if (!promise) {
    const query = capability === "all" ? "" : `?capability=${capability}`;
    promise = fetch(`/api/models${query}`).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<ModelsResponse>;
    });
    promise.catch(() => cache.delete(capability));
    cache.set(capability, promise);
  }
  return promise;
}

export function useModels(capability: Capability | "all") {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A cold server or a blip in the network: try again a few times before giving up.
    const attempt = (n: number) =>
      load(capability).then(
        (d) => {
          if (!alive) return;
          setData(d);
          setError(null);
        },
        (e: Error) => {
          if (!alive) return;
          if (n < 3) timer = setTimeout(() => attempt(n + 1), 1500 * 2 ** n);
          else setError(e.message);
        },
      );
    void attempt(0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [capability]);

  return { data, error, loading: !data && !error };
}

/** Drops the cached lists, e.g. after the user saved or removed their own OpenRouter key. */
export function forgetModels(): void {
  cache.clear();
}
