# Development callback relay

`absolute tunnel-relay` runs the public endpoint for the existing development
reverse tunnel. Set `ABSOLUTE_TUNNEL_TOKEN` on the relay and development client,
and configure the client's relay URL through `dev.tunnel` or
`ABSOLUTE_TUNNEL_RELAY`. Deploy the relay separately from production applications.

By default the relay forwards HTTP and public WebSockets to the local app.
For provider callbacks, restrict its public surface using an exact route list:

```sh
ABSOLUTE_TUNNEL_PUBLIC_ROUTES='[{"path":"/api/calendar/notify","method":"POST"}]'
```

When this variable is present, only listed HTTP methods and canonical pathnames
are forwarded. Query parameters are preserved but do not affect route matching.
Other requests return 404, including public WebSocket upgrades. An empty list
allows no public forwarding. Invalid JSON or route entries fail startup instead
of silently opening the relay. The token-protected control WebSocket remains
available so the local development process can connect.

This restriction does not authenticate provider callbacks. The local callback
handler must verify provider evidence before committing or queuing work. If the
local process is disconnected, allowed routes return 503. The relay is a
transport, not a durable callback queue. Use provider retries and an application
queue where available; reconcile missed changes when reconnecting.

For hosting liveness probes, optionally set `ABSOLUTE_TUNNEL_HEALTH_PATH=/healthz`.
GET on this exact path returns 204 from the relay even while the development
client is disconnected. This reports process liveness only; allowed callbacks
still return 503 while their local receiver is offline. Configure the hosting
health check to this path rather than opening access to the application root.

A dedicated server entry can import `startTunnelRelay` from
`@absolutejs/absolute/tunnel` rather than spawning the CLI:

```ts
import { startTunnelRelay } from '@absolutejs/absolute/tunnel';

startTunnelRelay({
  token: process.env.ABSOLUTE_TUNNEL_TOKEN!,
  healthPath: '/healthz',
  publicRoutes: [{ method: 'POST', path: '/api/calendar/notify' }],
});
```

Validate required secrets before starting. This entry point requires Bun and
must never be imported into a browser bundle.
