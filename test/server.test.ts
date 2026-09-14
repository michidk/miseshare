import { spawn, type ChildProcessByStdio } from 'node:child_process';
import net from 'node:net';
import type { Readable } from 'node:stream';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { parseServerEnvironment } from '../src/lib/server/env.server.js';

type ParticipantIdentity = {
  participant: { id: string; name: string };
  participantToken: string;
};

type RoomRequestInit = RequestInit & { identity?: ParticipantIdentity };

type RoomIdentity = ParticipantIdentity & {
  hostId: string;
  participants: Array<{ id: string }>;
  roomId: string;
};

type IceServerConfig = { urls: string | string[] };

let app: ChildProcessByStdio<null, Readable, Readable> | undefined;
let baseUrl: string;
const headHtml = '<script>window.__headHtmlLoaded = true;</script><noscript><img src="https://www.facebook.com/tr?id=test" alt=""></noscript>';

const getAvailablePort = () => new Promise<number>((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    if (!address || typeof address === 'string') {
      reject(new Error('Expected the port probe to use a TCP address'));
      return;
    }
    const { port } = address;
    probe.close(() => resolve(port));
  });
});

const waitForServer = async (url: string) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health/live`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${url}`);
};

const startServer = (port: number, env: NodeJS.ProcessEnv) => spawn(
  process.execPath,
  ['.output/server/index.mjs'],
  {
    cwd: new URL('..', import.meta.url),
    env: { ...env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

const requiredHeader = (response: Response, name: string) => {
  const value = response.headers.get(name);
  assert.ok(value, `Expected ${name} response header`);
  return value;
};

const roomRequest = async (pathname: string, { identity, ...init }: RoomRequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (identity) {
    headers.set('Authorization', `Bearer ${identity.participantToken}`);
    headers.set('X-Participant-Id', identity.participant.id);
  }
  return fetch(`${baseUrl}/api/rooms${pathname}`, { ...init, headers });
};

before(async () => {
  const port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const startedApp = startServer(port, {
      ...process.env,
      ADMIN_PASSWORD: '123',
      ADMIN_SESSION_SECRET: 'test-admin-session-secret-with-enough-entropy',
      EMOTES_ENABLED: 'false',
      VITE_HEAD_HTML: `  ${headHtml}  `,
      RATE_LIMIT_ENABLED: 'false',
      STUN_URLS: 'turn:relay.invalid:3478, stun:one.example.test:3478, stun:two.example.test:3478',
  });
  app = startedApp;
  await waitForServer(baseUrl);
});

after(() => {
  app?.kill('SIGTERM');
});

test('requires a PostgreSQL connection', () => {
  assert.throws(
    () => parseServerEnvironment({ ADMIN_PASSWORD: 'x', ADMIN_SESSION_SECRET: 'x'.repeat(32) }),
    /DATABASE_URL is required for room signaling/,
  );
});

test('requires an explicit admin password', () => {
  assert.throws(
    () => parseServerEnvironment({
      DATABASE_URL: 'postgresql://example.test/db',
      ADMIN_SESSION_SECRET: 'test-admin-session-secret-with-enough-entropy',
    }),
    /ADMIN_PASSWORD is required/,
  );
});

test('requires an independent admin session secret', () => {
  assert.throws(
    () => parseServerEnvironment({
      DATABASE_URL: 'postgresql://example.test/db',
      ADMIN_PASSWORD: 'test-password',
    }),
    /ADMIN_SESSION_SECRET is required/,
  );
});

test('rejects an undersized admin session secret', () => {
  assert.throws(
    () => parseServerEnvironment({
      DATABASE_URL: 'postgresql://example.test/db',
      ADMIN_PASSWORD: 'test-password',
      ADMIN_SESSION_SECRET: 'too-short',
    }),
    /ADMIN_SESSION_SECRET must contain at least 32 bytes/,
  );
});

test('leaves database migrations to the Vercel build instead of cold starts', () => {
  const environment = parseServerEnvironment({
    DATABASE_URL: 'postgresql://example.test/db',
    ADMIN_PASSWORD: 'test-password',
    ADMIN_SESSION_SECRET: 'test-admin-session-secret-with-enough-entropy',
    VERCEL: '1',
  });
  assert.equal(environment.migrateOnStartup, false);
});

test('uses Google STUN and keeps trusted head origins disabled when optional configuration is unset', async () => {
  const port = await getAvailablePort();
  const { STUN_URLS: _, VITE_HEAD_HTML: __, ...env } = process.env;
  const appWithoutHeadHtml = startServer(port, {
      ...env,
      ADMIN_PASSWORD: 'no-meta-test-password',
      ADMIN_SESSION_SECRET: 'no-meta-test-session-secret-with-enough-entropy',
      EMOTES_ENABLED: 'false',
      RATE_LIMIT_ENABLED: 'false',
  });
  await waitForServer(`http://127.0.0.1:${port}`);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const page = await response.text();
    assert.doesNotMatch(page, /__headHtmlLoaded|facebook\.com/);
    const policy = requiredHeader(response, 'content-security-policy');
    assert.doesNotMatch(policy, /connect-src[^;]*https:|img-src[^;]*https:/);
    assert.match(policy, /font-src 'self' https:\/\/fonts\.gstatic\.com data:/);
    const nonce = policy.match(/script-src 'self' 'nonce-([^']+)';/)?.[1];
    assert.ok(nonce);
    assert.match(policy, new RegExp(`style-src 'self' 'nonce-${nonce}'`));
    assert.doesNotMatch(policy, /unsafe-inline/);
    assert.match(page, new RegExp(`<script nonce="${nonce}"`));
    const config = await fetch(`http://127.0.0.1:${port}/config`).then((result) => result.json());
    assert.deepEqual(config, { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] });
  } finally {
    appWithoutHeadHtml.kill('SIGTERM');
  }
});

test('applies shared API rate limits with a retry interval', async () => {
  const port = await getAvailablePort();
  const rateLimitedApp = startServer(port, {
      ...process.env,
      ADMIN_PASSWORD: 'rate-limit-test-password',
      ADMIN_SESSION_SECRET: 'rate-limit-test-session-secret-with-enough-entropy',
      EMOTES_ENABLED: 'false',
      RATE_LIMIT_ENABLED: 'true',
      TRUST_PROXY: 'true',
  });
  await waitForServer(`http://127.0.0.1:${port}`);
  const identity = `2001:db8:${Date.now().toString(16).slice(-4)}:${Math.floor(Math.random() * 65_535).toString(16)}::1`;
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': identity },
        body: JSON.stringify({ password: 'x'.repeat(129) }),
      });
      assert.equal(response.status, 400);
    }
    const blocked = await fetch(`http://127.0.0.1:${port}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': identity },
      body: JSON.stringify({ password: 'x'.repeat(129) }),
    });
    assert.equal(blocked.status, 429);
    assert.match(requiredHeader(blocked, 'retry-after'), /^\d+$/);
    assert.equal((await blocked.json()).error.code, 'rate-limited');
  } finally {
    rateLimitedApp.kill('SIGTERM');
  }
});

test('ignores spoofable client IP headers when proxy trust is disabled', async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query('delete from request_rate_limits');
  await pool.end();
  const port = await getAvailablePort();
  const rateLimitedApp = startServer(port, {
      ...process.env,
      ADMIN_PASSWORD: 'direct-rate-limit-test-password',
      ADMIN_SESSION_SECRET: 'direct-rate-limit-session-secret-with-enough-entropy',
      EMOTES_ENABLED: 'false',
      RATE_LIMIT_ENABLED: 'true',
      TRUST_PROXY: 'false',
  });
  await waitForServer(`http://127.0.0.1:${port}`);
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Real-Ip': `198.51.100.${attempt + 1}`,
        },
        body: JSON.stringify({ password: 'x'.repeat(129) }),
      });
      assert.equal(response.status, 400);
    }
    const blocked = await fetch(`http://127.0.0.1:${port}/api/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Real-Ip': '203.0.113.250',
      },
      body: JSON.stringify({ password: 'x'.repeat(129) }),
    });
    assert.equal(blocked.status, 429);
  } finally {
    rateLimitedApp.kill('SIGTERM');
  }
});

test('serves the app and public client configuration', async () => {
  const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
  const liveness = await fetch(`${baseUrl}/health/live`);
  const configResponse = await fetch(`${baseUrl}/config`);
  const config = await configResponse.json() as { iceServers: IceServerConfig[] };
  const favicon = await fetch(`${baseUrl}/favicon.svg`);
  const socialThumbnail = await fetch(`${baseUrl}/social-thumbnail.png`);
  const robots = await fetch(`${baseUrl}/robots.txt`);
  const sitemap = await fetch(`${baseUrl}/sitemap.xml`);
  const landing = await fetch(`${baseUrl}/`);
  const room = await fetch(`${baseUrl}/room/abcd-2345`);

  assert.deepEqual(health, { ok: true });
  assert.deepEqual(await liveness.json(), { ok: true });
  assert.deepEqual(config.iceServers, [{
    urls: ['stun:one.example.test:3478', 'stun:two.example.test:3478'],
  }]);
  assert.equal('demoTurn' in config, false);
  assert.equal(configResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal(favicon.status, 200);
  assert.match(requiredHeader(favicon, 'content-type'), /image\/svg\+xml/);
  assert.match(requiredHeader(favicon, 'cache-control'), /max-age=0/);
  assert.equal(socialThumbnail.status, 200);
  assert.match(requiredHeader(socialThumbnail, 'content-type'), /image\/png/);
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /Sitemap: https:\/\/miseshare\.vercel\.app\/sitemap\.xml/);
  assert.equal(sitemap.status, 200);
  assert.match(requiredHeader(sitemap, 'content-type'), /application\/xml/);
  assert.match(await sitemap.text(), /<loc>https:\/\/miseshare\.vercel\.app\/<\/loc>/);
  assert.ok(config.iceServers.every(({ urls }) => {
    const candidates = Array.isArray(urls) ? urls : [urls];
    return candidates.every((url) => url.startsWith('stun:'));
  }));
  assert.equal(landing.status, 200);
  assert.equal(landing.headers.get('cache-control'), 'no-store');
  assert.equal(requiredHeader(landing, 'permissions-policy'), 'camera=(), microphone=(self), display-capture=(self)');
  assert.ok(landing.headers.get('x-request-id'));
  const landingPolicy = requiredHeader(landing, 'content-security-policy');
  const landingPage = await landing.text();
  const nonce = landingPolicy.match(/script-src 'self' 'nonce-([^']+)' https:/)?.[1];
  assert.ok(nonce);
  assert.match(landingPolicy, /connect-src 'self' https:/);
  assert.match(landingPolicy, /img-src 'self' data: https:/);
  assert.match(landingPolicy, new RegExp(`style-src 'self' 'nonce-${nonce}'`));
  assert.doesNotMatch(landingPolicy, /unsafe-inline/);
  assert.match(landingPage, new RegExp(`<script nonce="${nonce}">window\\.__headHtmlLoaded`));
  assert.match(landingPage, /<title>miseshare — Free Peer-to-Peer Screen Sharing<\/title>/);
  assert.match(landingPage, /<link rel="canonical" href="https:\/\/miseshare\.vercel\.app\/"/);
  assert.match(landingPage, /<meta name="robots" content="index, follow,/);
  assert.match(landingPage, /<meta property="og:image" content="https:\/\/miseshare\.vercel\.app\/social-thumbnail\.png"/);
  assert.match(landingPage, /<meta name="twitter:card" content="summary_large_image"/);
  assert.match(landingPage, /"@type":"WebApplication"/);
  assert.match(landingPage, /assets\/index-[^"']+\.js/);
  assert.match(landingPage, /<noscript><img src="https:\/\/www\.facebook\.com\/tr\?id=test"/);
  assert.equal(room.status, 200);
  const page = await room.text();
  assert.equal(room.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.match(page, /<meta name="robots" content="noindex, nofollow, noarchive"\s*\/>/);
  assert.doesNotMatch(page, /<meta name="robots" content="index, follow,/);
  assert.match(page, /Create a room/);
  assert.match(page, /Start room/);
  assert.match(page, /id="join-form"/);
  assert.match(page, />\s*Join room\s*</);
  assert.match(page, /id="join-password-dialog"/);
  assert.match(page, /Enter room password/);
  assert.doesNotMatch(page, /id="room-limit"|data-room-limit-step|people-stepper/);
  assert.match(page, /until the service limit is reached/);
  assert.match(page, /Chat &amp; activity/);
  assert.equal((page.match(/data-participant-count/g) || []).length, 2);
  assert.match(page, /Stream quality/);
  assert.match(page, /720p 60 FPS/);
  assert.match(page, /1080p 60 FPS/);
  assert.match(page, /Choose resolution, frame rate, and compression/);
  assert.doesNotMatch(page, /Browser video encoder|pipeline-summary/);
  assert.match(page, /Estimated upload/);
  assert.match(page, /id="stream-grid"/);
  assert.match(page, /id="leave-room-button"/);
  assert.match(page, /id="stream-button"/);
  assert.match(page, /id="local-audio-button"/);
  assert.match(page, /id="local-microphone-button"/);
  assert.match(page, /data-share-audio/);
  assert.equal((page.match(/data-share-audio/g) || []).length, 1);
  assert.match(page, /id="copy-invite-button"/);
  assert.match(page, /id="copy-room-code"/);
  assert.match(page, /class="room-privacy"/);
  assert.match(page, /encrypted between browsers/);
  assert.match(page, /requires a direct peer-to-peer connection/);
  assert.doesNotMatch(page, /TURN relay|may use a relay/);
  assert.match(page, /href="https:\/\/github\.com\/michidk\/miseshare"/);
});

test('admin dashboard requires its password and renders a redacted database overview', async () => {
  const signedOut = await fetch(`${baseUrl}/admin/`);
  const signedOutPage = await signedOut.text();
  assert.equal(signedOut.status, 200);
  assert.match(signedOutPage, /Admin dashboard/);
  assert.doesNotMatch(signedOutPage, /Database overview/);
  assert.match(requiredHeader(signedOut, 'cache-control'), /no-store/);
  assert.equal((await fetch(`${baseUrl}/admin/data`)).status, 401);

  const rejected = await fetch(`${baseUrl}/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'password=wrong',
  });
  assert.equal(rejected.status, 401);

  const accepted = await fetch(`${baseUrl}/admin/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'password=123',
  });
  assert.equal(accepted.status, 303);
  const cookie = requiredHeader(accepted, 'set-cookie');
  assert.match(cookie, /mise_admin_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);

  const seededRooms: RoomIdentity[] = [];
  for (let index = 0; index < 27; index += 1) {
    const created = await roomRequest('', { method: 'POST', body: '{}' });
    assert.equal(created.status, 201);
    seededRooms.push(await created.json() as RoomIdentity);
  }
  const closedRoom = seededRooms[0];
  const closed = await roomRequest(`/${closedRoom.roomId}`, { identity: closedRoom, method: 'DELETE' });
  assert.equal(closed.status, 204);

  const authHeaders = { cookie: cookie.split(';')[0] };
  const dashboard = await fetch(`${baseUrl}/admin/data`, { headers: authHeaders });
  const dashboardState = await dashboard.json();
  assert.equal(dashboard.status, 200);
  assert.equal(dashboardState.title, 'Overview');
  assert.match(dashboardState.content, /Database totals/);
  assert.match(dashboardState.content, /Rooms model/);
  assert.doesNotMatch(dashboardState.content, /password_hash|token_hash/i);
  assert.match(requiredHeader(dashboard, 'content-security-policy'), /default-src 'none'/);

  const activeSessions = await fetch(`${baseUrl}/admin/data?view=sessions&state=active`, { headers: authHeaders }).then((response) => response.json());
  assert.equal(activeSessions.title, 'Sessions');
  assert.match(activeSessions.content, /Active sessions/);
  assert.match(activeSessions.content, /Past <b>/);
  assert.match(activeSessions.content, /Page 1 of (?:[2-9]|[1-9]\d+)/);

  const secondSessionPage = await fetch(`${baseUrl}/admin/data?view=sessions&state=active&page=2`, { headers: authHeaders }).then((response) => response.json());
  assert.match(secondSessionPage.content, /Page 2 of (?:[2-9]|[1-9]\d+)/);

  const pastSessions = await fetch(`${baseUrl}/admin/data?view=sessions&state=past`, { headers: authHeaders }).then((response) => response.json());
  assert.match(pastSessions.content, /Past sessions/);
  assert.match(pastSessions.content, new RegExp(closedRoom.roomId));

  const participants = await fetch(`${baseUrl}/admin/data?view=participants`, { headers: authHeaders }).then((response) => response.json());
  assert.equal(participants.title, 'Participants');
  assert.match(participants.content, /Page 1 of (?:[2-9]|[1-9]\d+)/);

  const participantData = await fetch(`${baseUrl}/admin/data?view=participants&page=2`, { headers: authHeaders }).then((response) => response.json());
  assert.equal(participantData.view, 'participants');
  assert.equal(participantData.title, 'Participants');
  assert.match(participantData.content, /Page 2 of/);

  const signals = await fetch(`${baseUrl}/admin/data?view=signals`, { headers: authHeaders }).then((response) => response.json());
  assert.equal(signals.title, 'WebRTC signals');
  assert.match(signals.content, /Signaling payload contents are masked/);
});

test('room API enforces passwords without room-specific capacity settings', async () => {
  const createdResponse = await roomRequest('', {
    method: 'POST',
    body: JSON.stringify({ password: 'correct horse' }),
  });
  assert.equal(createdResponse.status, 201);
  const host = await createdResponse.json() as RoomIdentity;

  const missingPassword = await roomRequest(`/${host.roomId}/join`, { method: 'POST', body: '{}' });
  assert.equal(missingPassword.status, 401);
  assert.equal((await missingPassword.json()).error.code, 'password-required');

  const wrongPassword = await roomRequest(`/${host.roomId}/join`, {
    method: 'POST',
    body: JSON.stringify({ password: 'wrong' }),
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal((await wrongPassword.json()).error.code, 'invalid-password');

  const joinedResponse = await roomRequest(`/${host.roomId}/join`, {
    method: 'POST',
    body: JSON.stringify({ password: 'correct horse' }),
  });
  assert.equal(joinedResponse.status, 201);
  const viewer = await joinedResponse.json() as RoomIdentity;
  assert.equal(viewer.hostId, host.hostId);
  assert.match(viewer.participant.name, /^Anonymous [A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.deepEqual(viewer.participants.map(({ id }) => id), [host.participant.id]);

  const secondViewerResponse = await roomRequest(`/${host.roomId}/join`, {
    method: 'POST',
    body: JSON.stringify({ password: 'correct horse' }),
  });
  assert.equal(secondViewerResponse.status, 201);
});

test('room API assigns unique funny names and enforces the deployment capacity', async () => {
  const host = await roomRequest('', {
    method: 'POST',
    body: '{}',
  }).then((response) => response.json());
  const names = [];
  for (let index = 1; index < 12; index += 1) {
    const viewer = await roomRequest(`/${host.roomId}/join`, {
      method: 'POST',
      body: '{}',
    }).then((response) => response.json());
    names.push(viewer.participant.name);
  }
  assert.equal(names.length, 11);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.every((name) => /^Anonymous [A-Z][a-z]+ [A-Z][a-z]+$/.test(name)));

  const fullResponse = await roomRequest(`/${host.roomId}/join`, { method: 'POST', body: '{}' });
  assert.equal(fullResponse.status, 409);
  assert.equal((await fullResponse.json()).error.code, 'room-full');
});

test('room API relays authenticated WebRTC signaling through a durable mailbox', async () => {
  const host = await roomRequest('', {
    method: 'POST',
    body: '{}',
  }).then((response) => response.json());
  const viewer = await roomRequest(`/${host.roomId}/join`, {
    method: 'POST',
    body: '{}',
  }).then((response) => response.json());

  const offer = { type: 'offer', sdp: 'test-sdp' };
  const sendResponse = await roomRequest(`/${host.roomId}/signals`, {
    identity: viewer,
    method: 'POST',
    body: JSON.stringify({ recipientId: host.participant.id, kind: 'description', payload: offer }),
  });
  assert.equal(sendResponse.status, 202);

  const batchResponse = await roomRequest(`/${host.roomId}/signals?after=0`, { identity: host });
  assert.equal(batchResponse.status, 200);
  const batch = await batchResponse.json();
  assert.equal(batch.signals.length, 1);
  assert.equal(batch.signals[0].senderId, viewer.participant.id);
  assert.equal(batch.signals[0].recipientId, host.participant.id);
  assert.deepEqual(batch.signals[0].payload, offer);

  const telemetry = await roomRequest(`/${host.roomId}/telemetry`, {
    identity: viewer,
    method: 'POST',
    body: JSON.stringify({
      type: 'connection-route',
      peerId: host.participant.id,
      route: 'relay',
    }),
  });
  assert.equal(telemetry.status, 204);

  const unauthorized = await roomRequest(`/${host.roomId}/signals?after=0`);
  assert.equal(unauthorized.status, 401);
});
