import { lookup } from "node:dns/promises";
import { instanceInfo } from "@/lib/instance";
import { requestContext, runtimeCacheEnv } from "@/lib/runtimeCache";

export const dynamic = "force-dynamic";

// Field names and types of the cache client, with URL-like strings reduced to
// their host and resolved. Other string values are omitted: they may be
// credentials.
async function describeFieldsAsync(
  value: object,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(value)) {
    if (typeof field === "string" && /^https?:\/\//.test(field)) {
      const host = new URL(field).hostname;
      out[name] = {
        host,
        addresses: await lookup(host, { all: true })
          .then((entries) => entries.map((entry) => entry.address))
          .catch((error: unknown) => `lookup failed: ${String(error)}`),
      };
    } else if (typeof field === "function") {
      out[name] = "function";
    } else if (field != null && typeof field === "object") {
      out[name] = { type: "object", keys: Object.keys(field) };
    } else {
      out[name] = typeof field;
    }
  }
  return out;
}

// Reports which Runtime Cache client getCache() uses on this deployment and
// where its endpoint resolves. Header values are credentials, so only their
// names are returned.
export async function GET() {
  const context = requestContext();
  const contextCache = context.cache as
    | { get?: unknown; constructor?: { name?: string } }
    | undefined;
  const env = runtimeCacheEnv();

  let endpointHost: string | null = null;
  let endpointAddresses: string[] | string | null = null;
  if (env != undefined) {
    endpointHost = new URL(env.endpoint).host;
    try {
      const resolved = await lookup(new URL(env.endpoint).hostname, {
        all: true,
      });
      endpointAddresses = resolved.map((entry) => entry.address);
    } catch (error) {
      endpointAddresses = `lookup failed: ${String(error)}`;
    }
  }

  return Response.json({
    ...instanceInfo(),
    requestContextKeys: Object.keys(context),
    // getCache() uses this client when present, and BuildCache otherwise.
    contextCache:
      contextCache == undefined
        ? null
        : {
            className: contextCache.constructor?.name ?? null,
            fields: await describeFieldsAsync(contextCache),
            getSource:
              typeof contextCache.get === "function"
                ? String(contextCache.get).slice(0, 2000)
                : null,
          },
    buildCache: {
      endpointHost,
      endpointAddresses,
      headerNames: env == undefined ? null : Object.keys(env.headers),
    },
  });
}
