# Live location tracker

## Video demo

[Locus / location tracker — walkthrough on YouTube](https://youtu.be/h0M3PO9cBv4)

## Project overview

This repository is a small **real-time location sharing** demo with **two Node servers**: an **OIDC-style authentication API** (signup, sign-in, JWT issuance, discovery endpoints) and a **location tracker** that serves the map UI, verifies sessions over **HTTP + WebSocket**, and streams position updates through **Apache Kafka**. Other browsers see your marker move on a shared **Leaflet** map.

## Tech stack

| Area | Technology |
|------|------------|
| Runtime | [Bun](https://bun.sh/) |
| HTTP | [Express](https://expressjs.com/) 5 |
| Realtime | [Socket.IO](https://socket.io/) 4 |
| Messaging | [KafkaJS](https://kafka.js.org/) → Apache Kafka |
| Database | PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/) + `pg` |
| Auth tokens | RS256 JWT (`jsonwebtoken`, PEM keys); JWKS via `node-jose` |
| Map | [Leaflet](https://leafletjs.com/) |

Docker Compose is used locally **only for Kafka** (see [How to run locally](#how-to-run-locally)).

## Features implemented

- User **sign-up** and **sign-in** with salted **SHA-256** password storage (OIDC server + Drizzle schema)
- **OpenID Provider metadata**: `/.well-known/openid-configuration`, `/.well-known/jwks.json`
- **Bearer** userinfo endpoint: `GET /o/userinfo`
- **HTTP-only cookie** session on the tracker (`auth_token`) after redirect handoff
- **Protected static** map app; unauthenticated users redirect to the auth server
- **Socket.IO** connection gated by the same JWT (cookie on handshake)
- **Client → Kafka**: location updates published to topic `location-updates` (keyed by `userId` for per-user ordering)
- **Kafka → Socket.IO**: consumer rebroadcasts `server:location:update` to all connected clients
- **Database processor** consumer (logging / placeholder for persisting history)
- Basic **health** endpoints on both servers

## How to run locally

1. **Install [Bun](https://bun.sh/docs/installation)**.

2. **Clone and install**

   ```bash
   bun install
   ```

3. **Generate JWT keys** (writes `cert/private-key.pem` and `cert/public-key.pub`):

   ```bash
   bash key-gen.sh
   ```

4. **Configure environment** — copy `.env.example` to `.env` and set `DATABASE_URL` (PostgreSQL must exist; run Drizzle migrations as needed: `bun run db:generate` / `bun run db:migrate` per your workflow).

5. **Start Kafka**

   ```bash
   docker compose up -d
   ```

6. **Create the Kafka topic** (once per machine / after broker is up):

   ```bash
   bun run kafka:admin
   ```

7. **Run both servers** (two terminals):

   ```bash
   bun run oidc
   ```

   ```bash
   bun run tracker
   ```

8. **Use the app**

   - Auth / signup: `http://localhost:8000` (default OIDC port)
   - Map (after login): `http://localhost:3000` (default tracker port)

JWT verification reads keys from **`cert/private-key.pem`** and **`cert/public-key.pub`** (see `src/common/utils/cert.js`).

## Environment variables required

| Variable | Used by | Description |
|----------|---------|-------------|
| `DATABASE_URL` | OIDC server, Drizzle | PostgreSQL connection string |
| `OIDC_PORT` | Both (tracker redirects) | Auth server port; default **8000** |
| `TRACKER_PORT` | Controllers (redirect URL), tracker | Map server port; default **3000** |
| `PRIVATE_KEY_PATH` / `PUBLIC_KEY_PATH` | Documented in `.env.example` | **Not read by code today**; keys are loaded from fixed `cert/*.pem` paths |

Copy `.env.example` to `.env` and adjust values for your machine.

## Redis setup instructions

**Redis is not used in this codebase.** Persistence and caching rely on **PostgreSQL**; realtime fan-out uses **Socket.IO** and **Kafka**.

If you add Redis later (sessions, rate-limit counters, or Socket.IO adapter for multi-node), a typical local setup is:

```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

Point your application at `redis://localhost:6379` and wire it in your server bootstrap (not included here).

## Auth flow explanation

1. User opens **tracker** `http://localhost:3000/`. `requireAuth` looks for `auth_token` in cookies; if missing or invalid JWT, the browser is **redirected** to `http://localhost:<OIDC_PORT>/o/authenticate`.

2. On the auth server, the user signs in (**POST** `/o/authenticate/sign-in`). The server checks email/password (hash + salt in Postgres), issues an **RS256 JWT** (claims include `iss`, `sub`, `email`, names, `exp` ~1h), sets **`auth_token`** as an **httpOnly** cookie on the auth origin, and returns JSON with `redirect` to:

   `http://localhost:<TRACKER_PORT>/set-cookie?token=<JWT>`

3. The browser follows that URL. **`/set-cookie`** on the tracker validates the token, sets **`auth_token`** on the **tracker** origin (httpOnly, `sameSite: lax`), clears bad tokens on failure, and redirects to **`/`**.

4. Subsequent HTTP requests to the tracker send the cookie; **`verifyToken`** (public key) attaches `req.user`.

5. **Socket.IO** middleware parses the same cookie, verifies JWT, and sets **`socket.user`** so events run as that identity.

## WebSocket flow explanation

1. **Connect**: Browser loads `/socket.io/socket.io.js` from the tracker and calls `io()`. Cookies are sent on the handshake; the server rejects the connection if JWT is missing or invalid.

2. **Identity**: On `connect`, the client emits **`client:whoami`**. The server responds with **`server:whoami`** and `{ userId }` so the client can **ignore its own** `server:location:update` broadcasts.

3. **Publish**: On an interval, the client reads geolocation and emits **`client:location:update`** with `{ latitude, longitude }`. The tracker’s Kafka **producer** writes to **`location-updates`**.

4. **Consume & broadcast**: A Kafka **consumer** in the same process reads messages and the server **`io.emit`**’s **`server:location:update`** to every socket (including the originator’s tab — the client filters self via `userId`).

5. **Disconnect**: On socket disconnect, the server **`io.emit`**’s **`server:user:disconnected`** so other clients remove that user’s marker.

## Rate limiting logic explanation

There is **no server-side rate limiting** in this repository (no middleware, Redis token bucket, or similar).

The only pacing is **client-side**: `public/index.html` uses `setInterval(..., 5 * 1000)`, so the browser requests geolocation and emits **`client:location:update`** about **once every 5 seconds**. The server does not throttle or drop excess events; invalid payloads are ignored (`latitude` / `longitude` must be numbers).

To add rate limiting, you would typically:

- enforce a max events/sec per `userId` or per socket in the **`client:location:update`** handler, and/or
- add **Express** / **Socket.IO** middleware with a store (**Redis** or in-memory for single instance) for sliding-window or fixed-window limits.
