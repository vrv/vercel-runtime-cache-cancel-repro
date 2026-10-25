# Runtime Cache `get()` leaves an unhandled rejection that exits the instance

Reading a non-fresh entry from Vercel Runtime Cache (`getCache().get()` from
`@vercel/functions`) discards the response body with a `cancel()` call that is
never awaited and has no `.catch`. If the connection to the cache endpoint
closes before the body is complete, that promise rejects with
`TypeError: terminated` (cause `UND_ERR_SOCKET: other side closed`), nothing
handles it, and the Vercel runtime logs `Unhandled Rejection` and exits the
process with status 128.

The same code is in both cache clients:

- the client the Vercel runtime injects through the request context, which
  `getCache()` uses on Vercel (returned by `/api/probe` below):

  ```js
  if(s.headers.get(ri)!=="fresh")return s.body?.cancel?.(),null;
  ```

- `BuildCache` in `@vercel/functions/cache/build-client.js` (3.0.0 through
  3.10.1), used when there's no request-context cache:

  ```js
  if (cacheState !== PkgCacheState.Fresh) {
    res.body?.cancel?.();
    return null;
  }
  ```

## Reproduction

### 1. Locally

```bash
npm install
npm run repro
```

```
get() returned: null
unhandledRejection: TypeError: terminated | cause: UND_ERR_SOCKET
```

`repro.mjs` points `BuildCache` at a local server that answers with
`x-vercel-cache-state: stale` and closes the socket before the body is complete.

### 2. On Vercel

```bash
npm install
npx vercel --prod
```

`vercel.json` pins functions to `sfo1`.

**`/api/probe`** shows the cache client `getCache()` uses on this deployment.
It returns the source of the request-context cache's `get()`, which contains
the unawaited `s.body?.cancel?.()`.

```bash
curl -s https://<deployment>/api/probe | jq .contextCache.getSource
```

**`/api/stale`** stores an entry with `ttl: 1`, waits 2.5 s, reads it back
through `getCache()`, and records the cache request. The endpoint returns a
non-fresh state, so `get()` takes the `cancel()` branch on real
infrastructure:

```json
"afterTtl": {
  "result": null,
  "fetches": [{
    "method": "GET",
    "host": "sfo1.suspense-cache.vercel-infra.com",
    "status": 200,
    "cacheState": "stale-while-revalidate"
  }]
}
```

**`/api/crash`** triggers the failure. The real endpoint can't be made to
drop a connection on demand, so this route runs `BuildCache.get()` (the same
code as the request-context client) against a server inside the function
that sends stale headers and then closes the socket. To also watch a
concurrent request, start a slow one first:

```bash
curl -s "https://<deployment>/api/slow?s=15" & sleep 2
curl -s https://<deployment>/api/crash | jq
sleep 3; curl -s https://<deployment>/api/probe | jq .instance
wait
```

Runtime logs for `/api/crash`:

```
Unhandled Rejection: TypeError: terminated
    at Fetch.onAborted (node:internal/deps/undici/undici:11581:53)
    at Fetch.emit (node:events:519:28)
    at Fetch.terminate (node:internal/deps/undici/undici:10738:14)
    at Object.onError (node:internal/deps/undici/undici:11701:38)
    at Request.onError (node:internal/deps/undici/undici:2304:31)
    at Object.errorRequest (node:internal/deps/undici/undici:1742:17)
    at Socket.<anonymous> (node:internal/deps/undici/undici:6595:16)
    ...
⨯ unhandledRejection: TypeError: terminated
  [cause]: Error [SocketError]: other side closed { code: 'UND_ERR_SOCKET', ... }
Node.js process exited with exit status: 128. The logs above can help with debugging the issue.
```

In our run, the `/api/slow` request already in flight on the same instance
still completed with a 200. The `/api/probe` sent 3 s after the crash landed
on a new instance (`uptimeSeconds: 0`). Each occurrence costs an instance and
a cold start for the requests that follow.

## In production

We see 1–3 of these a day on a Next.js app on Fluid Compute in `sfo1`, on
whatever route happens to share the instance. In every one the remote end
is `sfo1.suspense-cache.vercel-infra.com`, which resolves to
`production-suspense-cache-alb-1594080419.us-west-1.elb.amazonaws.com`
(52.52.49.20, 52.8.33.101, 54.241.196.131, 52.8.49.41). The remote side
closes a long-lived keep-alive connection, for example after 637 KB written
and 5.7 MB read:

```
⨯ unhandledRejection: TypeError: terminated
  [cause]: Error [SocketError]: other side closed {
    code: 'UND_ERR_SOCKET',
    socket: { remoteAddress: '52.52.49.20', remotePort: 443, bytesWritten: 637224, bytesRead: 5701276 }
  }
Node.js process exited with exit status: 128
```

## Suggested fix

In both clients:

```js
res.body?.cancel?.()?.catch(() => {});
```

or `await` it inside the existing `try`.

## Versions

- `@vercel/functions` 3.10.1 (also present in 3.0.0)
- Next.js 16.4.1, Node.js 22.x, Fluid Compute, `sfo1`
- Tested October 25, 2026
