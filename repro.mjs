// Local reproduction without Vercel: run `npm install && npm run repro`.
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";

const require = createRequire(import.meta.url);
const { BuildCache } = require(
  path.resolve("node_modules/@vercel/functions/cache/build-client.js"),
);

process.on("unhandledRejection", (error) => {
  console.log("unhandledRejection:", String(error), "| cause:", error?.cause?.code);
});

const server = createServer((socket) => {
  socket.once("data", () => {
    socket.write(
      "HTTP/1.1 200 OK\r\nx-vercel-cache-state: stale\r\ncontent-length: 1000\r\n\r\n{\"partial\":",
    );
    setTimeout(() => socket.destroy(), 5);
  });
});

server.listen(0, "127.0.0.1", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const response = await realFetch(...args);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return response;
  };
  const cache = new BuildCache({
    endpoint: `http://127.0.0.1:${server.address().port}/`,
    headers: {},
  });
  console.log("get() returned:", await cache.get("any-key"));
  setTimeout(() => server.close(), 200);
});
