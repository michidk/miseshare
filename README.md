# mise

A deliberately small, open-source screen sharing service. Create a room, send a link, and let several participants share at once—no accounts, downloads, or persisted room history.

[![mise landing page](.playwright/screenshots/mise.png)](https://miseshare.vercel.app)

Live demo: [miseshare.vercel.app](https://miseshare.vercel.app)

## Related project

If a connection fails, use the in-room connection check or [icecheck](https://github.com/michidk/icecheck) ([live tool](https://icecheck.vercel.app)) to isolate signaling, ICE candidate, data-channel, and media-path problems between two browsers.

Native WebRTC video tracks carry the 720p, 1080p, and 60 fps screen-sharing presets over encrypted browser connections. A configured TURN server can relay that encrypted traffic when a direct path is unavailable. A separate lossless text mode sends pixel-exact tile deltas over WebRTC data channels. A small REST API stores temporary room admission and WebRTC signaling messages in PostgreSQL; it never receives screen, chat, or audio data.

The Node server and browser application are authored in strict TypeScript. The client build compiles `src/app.ts` to the browser bundle in `public/app.js`.

## Run it locally

```bash
npm install
npm run db:up
export DATABASE_URL='postgresql://mise:mise@127.0.0.1:54329/mise'
export ADMIN_PASSWORD='choose-a-strong-local-password'
export ADMIN_SESSION_SECRET='generate-at-least-32-random-bytes'
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Screen capture works on `localhost`; a deployed instance must use HTTPS.

Local development uses the PostgreSQL service in `compose.yaml`, bound to loopback on port `54329`. `DATABASE_URL` is mandatory in every environment; there is no in-memory fallback. The schema is defined with Drizzle ORM in `src/room-api/internal/schema.ts`, with generated migrations tracked in `drizzle/`. The server applies pending committed migrations before accepting requests; a PostgreSQL advisory lock serializes concurrent serverless cold starts.

After changing the schema, generate and validate a migration before applying it:

```bash
npm run db:generate
npm run db:check
npm run db:migrate
```

## Deploy to Vercel

Provision a Neon PostgreSQL database from the Vercel Marketplace, connect it to the project, and run the migration with the production `DATABASE_URL`. The repository exports its Express HTTP server for Vercel and keeps the local `npm start` entrypoint:

```bash
npx vercel@latest env pull .env.production.local --environment=production
set -a && source .env.production.local && set +a
npm run db:migrate
npx vercel@latest --prod
```

Vercel serves files in `public/` from its CDN and runs the room REST API as stateless Node Functions. Every invocation reads the same PostgreSQL room and signaling tables, so participants do not need to reach the same Function instance. `DATABASE_URL` is mandatory on Vercel; the server fails fast instead of silently creating instance-local rooms.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | HTTP bind address |
| `BASE_PATH` | _(empty)_ | Optional URL prefix, such as `/previews/mise` |
| `MAX_PARTICIPANTS` | `12` | Deployment ceiling for total room participants, including the host (2–12) |
| `DATABASE_URL` | _(required)_ | PostgreSQL connection string; use Docker locally and Neon in production |
| `ADMIN_PASSWORD` | _(required)_ | Password for the read-only `/admin` database dashboard |
| `ADMIN_SESSION_SECRET` | _(required)_ | Independent random secret used to sign eight-hour admin sessions; use at least 32 bytes |
| `SECURE_COOKIES` | production/Vercel: `true`; otherwise `false` | Require HTTPS for the admin session cookie |
| `TRUST_PROXY` | `false` (Vercel configures one trusted hop) | Trust proxy-derived client IPs for rate limits; enable only behind a trusted proxy |
| `RATE_LIMIT_ENABLED` | `true` | Enforce PostgreSQL-backed create, join, signal, and admin-login limits across instances |
| `REQUEST_LOGGING` | production/Vercel: `true`; otherwise `false` | Emit structured request ID, status, path, and duration logs; server errors are always logged |
| `EMOTES_ENABLED` | `true` | Load the global emote catalog and serve assets through the same-origin image proxy |
| `STUN_URLS` | `stun:main.lohr.dev:3478,stun:stun.l.google.com:19302` | Comma-separated STUN URLs; the second default is a public fallback and non-STUN entries are ignored |
| `TURN_URLS` | _(empty)_ | Comma-separated `turn:` or `turns:` URLs for a coturn-compatible relay |
| `TURN_SHARED_SECRET` | _(required with `TURN_URLS`)_ | coturn REST authentication secret; never sent to browsers |
| `TURN_TTL_SECONDS` | `3600` | Lifetime of generated TURN credentials, from 60 to 86400 seconds |

Browsers receive both defaults and may query them concurrently; WebRTC does not guarantee a strictly sequential failover order.

For reliable connectivity across restrictive NATs and corporate networks, deploy coturn with its REST API shared-secret mechanism, then set `TURN_URLS` and `TURN_SHARED_SECRET`. The app creates short-lived HMAC credentials per `/config` request and refreshes them before ICE recovery; the shared secret never leaves the server. A normal HTTP reverse proxy does not replace TURN because it cannot relay WebRTC media.

Global Twitch, BetterTTV, FrankerFaceZ, and 7TV emotes are available without provider credentials. Native Twitch emote metadata comes from the public Adam C Younis aggregate catalog. Provider URLs are never exposed to the browser. The server validates provider hosts and image types, applies size and timeout limits, caches the result, and serves it from `/emotes/assets/:id`. Disable this optional outbound provider access with `EMOTES_ENABLED=false`.

## How it works

- The REST API creates a random room code, hashes optional room passwords with scrypt, and atomically enforces the deployment-wide participant capacity.
- Room, participant, and signaling records are short-lived. Host heartbeats extend the room while the tab is open; stale participants and signaling messages expire automatically.
- Each browser receives an opaque participant token. The API hashes that token before storage and derives the signaling sender from the authenticated request rather than trusting client-provided identity.
- Browsers exchange SDP descriptions and ICE candidates through authenticated REST mailboxes. Once negotiation completes, native `RTCPeerConnection` data channels and media tracks communicate over encrypted direct or TURN-relayed paths.
- Every participant can publish independently, so several screens can be live at once. Each publisher opens an encrypted peer connection to every other room participant.
- The first media codec is `text-lossless-v1`: it captures native RGBA pixels, compares 128 px tiles exactly, DEFLATE-compresses only changed tiles, and sends a periodic repair keyframe every 15 seconds. Frames are split into 48 KiB messages; a dropped or invalid delta triggers an immediate keyframe request before rendering resumes.
- Stream audio is kept on a separate native WebRTC media track. Publishers can stop sending it without restarting the screen codec, and every receiver can mute each incoming stream independently.
- Codec settings and stream ownership are room metadata. Cards show the host, current codec settings, and audio state without coupling the UI to the encoder implementation.
- A host-coordinated activity log records joins, leaves, stream starts/stops, audio changes, and settings changes alongside chat. Only the latest 100 entries live in the host's browser memory.
- `src/room-api/index.ts` is the server boundary for room admission and signaling storage. Its Drizzle/PostgreSQL implementation remains internal.
- `src/signaling/index.ts` is the browser boundary for REST room lifecycle, heartbeat, and signaling mailboxes.
- `src/rtc/index.ts` owns native WebRTC negotiation and recovery, fixed control/screen/diagnostics channels, MessagePack serialization, and audio/video transceivers.
- `src/media/index.ts` owns encoder, renderer, backpressure, and presentation cleanup. `src/room/index.ts` owns validated host/viewer messages and UI session state.
- `src/chat-ui/index.ts`, `src/emotes/index.ts`, and `src/ice-config/index.ts` isolate browser chat behavior, the same-origin emote proxy, and ephemeral ICE configuration behind small public interfaces.
- There is no recording, analytics, account system, or backend media-processing path.

The full-mesh layout is ideal for small groups. Its bandwidth and connection count grow with every participant, so use an SFU for large audiences rather than raising the 12-person ceiling.

## Operations and verification

`GET /health/live` checks the process; `GET /health/ready` (and the compatibility endpoint `GET /health`) checks PostgreSQL readiness. Successful requests include an `X-Request-Id` header. The `/admin` dashboard paginates in PostgreSQL and intentionally redacts password hashes, participant tokens, and signaling payloads.

Run the normal verification suite with `npm run verify`. To include the two-browser room flow and mobile-layout checks in Chromium and Firefox, install the browsers once and run the full suite:

```bash
npx playwright install chromium firefox
npm run verify:full
```

Browser screenshots, videos, traces, and reports stay under `.playwright/`. CI also checks production dependency advisories and fails when generated browser bundles drift from their TypeScript sources.

## License

MIT
