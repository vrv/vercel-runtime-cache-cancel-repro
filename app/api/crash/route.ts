import { createRequire } from "node:module";
import { createServer, type Socket } from "node:net";
import path from "node:path";
import { instanceInfo } from "@/lib/instance";

export const dynamic = "force-dynamic";

type BuildCacheClass = new (options: {
  endpoint: string;
  headers: Record<string, string>;
  onError?: (error: unknown) => void;
}) => { get(key: string): Promise<unknown> };

// BuildCache isn't in the package's exports map, so load the file by path.
function loadBuildCache(): BuildCacheClass {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  return require(
    path.join(
      process.cwd(),
      "node_modules/@vercel/functions/cache/build-client.js",
    ),
  ).BuildCache;
}

// Stands in for a Runtime Cache endpoint that returns a stale entry and then
// loses the connection before the body is complete. The real endpoint can't be
// made to do this on demand.
function startDroppingServer(): Promise<{ url: string; close: () => void }> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("data", () => {
      socket.write(
        "HTTP/1.1 200 OK\r\n" +
          "x-vercel-cache-state: stale\r\n" +
          "content-type: application/json\r\n" +
          "content-length: 1000\r\n\r\n" +
          '{"partial":',
      );
      setTimeout(() => socket.destroy(), 5);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address != null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => {
          for (const socket of sockets) socket.destroy();
          server.close();
        },
      });
    });
  });
}

export async function GET() {
  const BuildCache = loadBuildCache();
  const server = await startDroppingServer();

  // BuildCache.get() returns as soon as it sees a non-fresh state and calls
  // res.body?.cancel?.() without awaiting it. Delaying the response object
  // by a few ms lets the socket close first, which is the timing an
  // instance hits when its event loop is busy with other requests.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await realFetch(...args);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return response;
  };
  let result: unknown;
  try {
    const cache = new BuildCache({
      endpoint: server.url,
      headers: {},
      onError: (error) => console.error("BuildCache onError", error),
    });
    result = await cache.get("any-key");
  } finally {
    globalThis.fetch = realFetch;
    server.close();
  }

  return Response.json({
    ...instanceInfo(),
    getResult: result,
    note: "get() returned; the cancel() rejection is now unhandled",
  });
}
