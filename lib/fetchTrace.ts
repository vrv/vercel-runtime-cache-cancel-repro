export interface TracedFetch {
  method: string;
  host: string;
  status: number;
  cacheState: string | null;
}

// Records the cache client's requests while `fn` runs. Only the host is kept
// from each URL; paths and headers can carry credentials.
export async function traceFetches<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; fetches: TracedFetch[] }> {
  const fetches: TracedFetch[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await realFetch(input, init);
    const url =
      input instanceof Request ? input.url : new URL(String(input)).toString();
    fetches.push({
      method: init?.method ?? (input instanceof Request ? input.method : "GET"),
      host: new URL(url).host,
      status: response.status,
      cacheState: response.headers.get("x-vercel-cache-state"),
    });
    return response;
  };
  try {
    return { result: await fn(), fetches };
  } finally {
    globalThis.fetch = realFetch;
  }
}
