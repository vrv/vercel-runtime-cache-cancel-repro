# Runtime Cache `get()` leaves an unhandled rejection that exits the instance

`BuildCache.get()` in `@vercel/functions` discards the body of a non-fresh
entry with a call it never awaits:

```js
// @vercel/functions/cache/build-client.js (3.0.0 through 3.10.1)
if (cacheState !== PkgCacheState.Fresh) {
  res.body?.cancel?.();   // not awaited, no .catch
  return null;
}
```

If the connection to the cache endpoint closes before the body is complete,
`cancel()` returns a promise rejected with `TypeError: terminated` (cause
`UND_ERR_SOCKET: other side closed`). Nothing handles it. On Vercel, the
runtime's `unhandledRejection` listener then exits the process with status 128,
failing every request in flight on that Fluid instance.

## Reproduction

### 1. Locally, no Vercel needed

```bash
npm install
npm run repro
```

```
get() returned: null
unhandledRejection: TypeError: terminated | cause: UND_ERR_SOCKET
```

`repro.mjs` points the real `BuildCache` at a local server that answers with
`x-vercel-cache-state: stale` and closes the socket before the body is complete.

### 2. On Vercel

```bash
npm install
npx vercel --prod
```

**`/api/probe`** shows which cache client `getCache()` uses on this deployment
(the request-context cache if the runtime provides one, `BuildCache`
otherwise) and where `RUNTIME_CACHE_ENDPOINT` resolves. It returns header
names only, never values.

```bash
curl -s https://<deployment>/api/probe | jq
```

**`/api/stale`** stores an entry with `ttl: 1`, waits 2.5 s, and reads it
back. `direct.cacheState` is the `x-vercel-cache-state` the real endpoint
returns, and that state is what sends `get()` down the `cancel()` branch.

```bash
curl -s https://<deployment>/api/stale | jq
```

**`/api/crash`** triggers the failure. The real cache endpoint can't be made
to drop a connection on demand, so the route runs the real `BuildCache`
against a server inside the function that sends stale headers and then
closes the socket. To see the effect on other requests, start a slow request
first, then call the crash route while it's running:

```bash
curl -s "https://<deployment>/api/slow?s=15" & sleep 1
curl -s https://<deployment>/api/crash | jq
wait
```

Expected in the deployment's runtime logs:

```
Unhandled Rejection: TypeError: terminated
  [cause]: SocketError: other side closed  code: 'UND_ERR_SOCKET'
Node.js process exited with exit status: 128
```

If both requests landed on the same instance (compare the `instance` field),
`/api/slow` fails as well.

### What we see in production

We see about 1–3 of these a day across our Fluid instances, on unrelated
routes (any route that reads Runtime Cache). Every one is a socket to the
same few AWS us-west-1 addresses on port 443, from a `sfo1` function, closed
by the remote end after a long keep-alive (for example 637 KB written and
5.7 MB read on one socket):

```
⨯ unhandledRejection: TypeError: terminated
    at Object.onError (...)
    at Object.errorRequest (...)
    at TLSSocket.<anonymous> (...) {
  [cause]: Error [SocketError]: other side closed {
    code: 'UND_ERR_SOCKET',
    socket: { remoteAddress: '52.52.49.20', remotePort: 443, bytesWritten: 637224, bytesRead: 5701276 }
  }
}
Node.js process exited with exit status: 128
```

## Suggested fix

```js
res.body?.cancel?.()?.catch(() => {});
```

or `await` it inside the existing `try`.

## Versions

- `@vercel/functions` 3.10.1 (the bug is also present in 3.0.0)
- Next.js 16.4.1, Node.js 22.x, Fluid Compute
- Tested October 2026
