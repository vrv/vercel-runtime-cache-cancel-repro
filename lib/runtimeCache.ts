// Mirrors @vercel/functions/get-context.js, which the package doesn't export.
export function requestContext(): Record<string, unknown> {
  const holder = (globalThis as Record<symbol, unknown>)[
    Symbol.for("@vercel/request-context")
  ] as { get?: () => Record<string, unknown> } | undefined;
  return holder?.get?.() ?? {};
}

export function runtimeCacheEnv():
  | { endpoint: string; headers: Record<string, string> }
  | undefined {
  const endpoint = process.env.RUNTIME_CACHE_ENDPOINT;
  const headers = process.env.RUNTIME_CACHE_HEADERS;
  if (endpoint == undefined || headers == undefined) return undefined;
  return { endpoint, headers: JSON.parse(headers) as Record<string, string> };
}
