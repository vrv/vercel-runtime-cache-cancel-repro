import { getCache } from "@vercel/functions";
import { traceFetches } from "@/lib/fetchTrace";
import { instanceInfo } from "@/lib/instance";
import { requestContext, runtimeCacheEnv } from "@/lib/runtimeCache";

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Stores an entry with a 1 second TTL, waits for it to go stale, then reads it
// back through getCache(). `afterTtl.fetches` shows the x-vercel-cache-state
// the endpoint returned; any value other than "fresh" sends get() down the
// `res.body?.cancel?.()` branch. `direct` repeats this against
// RUNTIME_CACHE_ENDPOINT when the runtime exposes it.
export async function GET() {
  const key = `stale-repro-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const cache = getCache();
  await cache.set(key, { hello: "world" }, { ttl: 1 });
  const fresh = await cache.get(key);
  await sleep(2500);
  const afterTtl = await traceFetches(() => cache.get(key));

  let direct: Record<string, unknown> | null = null;
  const env = runtimeCacheEnv();
  if (env != undefined) {
    // Same request BuildCache.get() sends for an un-namespaced key.
    const directKey = `${key}-direct`;
    await fetch(`${env.endpoint}${directKey}`, {
      method: "POST",
      headers: { ...env.headers, "x-vercel-revalidate": "1" },
      body: JSON.stringify({ hello: "world" }),
    });
    await sleep(2500);
    const res = await fetch(`${env.endpoint}${directKey}`, {
      headers: env.headers,
    });
    const body = await res.text();
    direct = {
      status: res.status,
      cacheState: res.headers.get("x-vercel-cache-state"),
      bodyBytes: body.length,
    };
  }

  return Response.json({
    ...instanceInfo(),
    usesContextCache: requestContext().cache != undefined,
    viaGetCache: { fresh, afterTtl },
    direct,
  });
}
