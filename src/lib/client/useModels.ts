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
    load(capability).then(
      (d) => alive && setData(d),
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [capability]);

  return { data, error, loading: !data && !error };
}
