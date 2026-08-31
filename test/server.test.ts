import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process';
import net from 'node:net';
import type { Readable } from 'node:stream';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

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

const waitForOutput = (stream: Readable, expected: string) => new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Timed out waiting for: ${expected}`)), 5_000);
  stream.on('data', (chunk) => {
    if (!chunk.toString().includes(expected)) return;
    clearTimeout(timeout);
    resolve();
  });
});

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
  const startedApp = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      ADMIN_PASSWORD: '123',
      ADMIN_SESSION_SECRET: 'test-admin-session-secret-with-enough-entropy',
      EMOTES_ENABLED: 'false',
      VITE_HEAD_HTML: `  ${headHtml}  `,
      RATE_LIMIT_ENABLED: 'false',
      PORT: String(port),
      STUN_URLS: 'turn:relay.invalid:3478, stun:one.example.test:3478, stun:two.example.test:3478',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app = startedApp;
  await waitForOutput(startedApp.stdout, 'miseshare is ready');
});

after(() => {
  app?.kill('SIGTERM');
});

test('refuses to start without a PostgreSQL connection', () => {
  const { DATABASE_URL: _, VERCEL: __, ...env } = process.env;
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: new URL('..', import.meta.url),
    env,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL is required for room signaling/);
});

test('requires an explicit admin password', () => {
  const { ADMIN_PASSWORD: _, ...env } = process.env;
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: new URL('..', import.meta.url),
    env: { ...env, ADMIN_SESSION_SECRET: 'test-admin-session-secret-with-enough-entropy' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ADMIN_PASSWORD is required/);
});

test('requires an independent admin session secret', () => {
  const { ADMIN_SESSION_SECRET: _, ...env } = process.env;
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: new URL('..', import.meta.url),
    env: { ...env, ADMIN_PASSWORD: 'test-password' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ADMIN_SESSION_SECRET is required/);
});

test('rejects an undersized admin session secret', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, ADMIN_PASSWORD: 'test-password', ADMIN_SESSION_SECRET: 'too-short' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ADMIN_SESSION_SECRET must contain at least 32 bytes/);
});

test('uses Google STUN and leaves app HTML and CSP unchanged when optional configuration is unset', async () => {
  const port = await getAvailablePort();
  const { STUN_URLS: _, VITE_HEAD_HTML: __, ...env } = process.env;
  const appWithoutHeadHtml = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...env,
      ADMIN_PASSWORD: 'no-meta-test-password',
      ADMIN_SESSION_SECRET: 'no-meta-test-session-secret-with-enough-entropy',
      EMOTES_ENABLED: 'false',
      PORT: String(port),
      RATE_LIMIT_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForOutput(appWithoutHeadHtml.stdout, 'miseshare is ready');
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.doesNotMatch(await response.text(), /__headHtmlLoaded|facebook\.com/);
    const policy = requiredHeader(response, 'content-security-policy');
    assert.doesNotMatch(policy, /https:|unsafe-inline.*script|script-src[^;]*unsafe-inline/);
    assert.match(policy, /script-src 'self';/);
    const config = await fetch(`http://127.0.0.1:${port}/config`).then((result) => result.json());
    assert.deepEqual(config, { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] });
  } finally {
    appWithoutHeadHtml.kill('SIGTERM');
  }
});

test('applies shared API rate limits with a retry interval', async () => {
  const port = await getAvailablePort();
  const rateLimitedApp = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      ADMIN_PASSWORD: 'rate-limit-test-password',
      ADMIN_SESSION_SECRET: 'rate-limit-test-session-secret-with-enough-entropy',
      EMOTES_ENABLED: 'false',
      PORT: String(port),
      RATE_LIMIT_ENABLED: 'true',
      TRUST_PROXY: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForOutput(rateLimitedApp.stdout, 'miseshare is ready');
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

test('serves the app and public client configuration', async () => {
  const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
  const liveness = await fetch(`${baseUrl}/health/live`);
  const configResponse = await fetch(`${baseUrl}/config`);
  const config = await configResponse.json() as { iceServers: IceServerConfig[] };
  const favicon = await fetch(`${baseUrl}/favicon.svg`);
  const appClient = await fetch(`${baseUrl}/app.js`);
  assert.equal(appClient.headers.get('cache-control'), 'no-store');
  const appClientSource = await appClient.text();
  const landing = await fetch(`${baseUrl}/`);
  const room = await fetch(`${baseUrl}/room/abc12345`);

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
  assert.ok(config.iceServers.every(({ urls }) => {
    const candidates = Array.isArray(urls) ? urls : [urls];
    return candidates.every((url) => url.startsWith('stun:'));
  }));
  assert.match(appClientSource, /getDisplayMedia/);
  assert.match(appClientSource, /RTCPeerConnection/);
  assert.doesNotMatch(appClientSource, /PeerJS/);
  assert.doesNotMatch(appClientSource, /window\.prompt/);
  assert.match(appClientSource, /text-lossless-v1/);
  assert.match(appClientSource, /text-frame-start/);
  assert.match(appClientSource, /text-frame-chunk/);
  assert.match(appClientSource, /text-keyframe-request/);
  assert.equal(landing.status, 200);
  assert.equal(landing.headers.get('cache-control'), 'no-store');
  assert.equal(requiredHeader(landing, 'permissions-policy'), 'camera=(), microphone=(self), display-capture=(self)');
  assert.ok(landing.headers.get('x-request-id'));
  const landingPolicy = requiredHeader(landing, 'content-security-policy');
  const landingPage = await landing.text();
  assert.match(landingPolicy, /connect-src 'self' https:/);
  assert.match(landingPolicy, /img-src 'self' data: https:/);
  assert.match(landingPolicy, /script-src 'self' https: 'unsafe-inline'/);
  assert.match(landingPage, /<base href="\.\/" \/>/);
  assert.ok(landingPage.includes(`${headHtml}\n  </head>`));
  assert.match(landingPage, /<noscript><img src="https:\/\/www\.facebook\.com\/tr\?id=test"/);
  assert.equal(room.status, 200);
  const page = await room.text();
  assert.ok(page.includes(`${headHtml}\n  </head>`));
  assert.match(page, /<base href="\.\.\/" \/>/);
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
  const dashboard = await fetch(`${baseUrl}/admin/`, { headers: authHeaders });
  const dashboardPage = await dashboard.text();
  assert.equal(dashboard.status, 200);
  assert.match(dashboardPage, /<h1[^>]*>Overview<\/h1>/);
  assert.match(dashboardPage, /Database totals/);
  assert.match(dashboardPage, /Database models/);
  assert.match(dashboardPage, /Rooms model/);
  assert.match(dashboardPage, /admin\.js/);
  assert.match(dashboardPage, /Updated automatically with TanStack Query/);
  assert.doesNotMatch(dashboardPage, /Refresh|Read-only access/);
  assert.doesNotMatch(dashboardPage, /password_hash|token_hash/i);
  assert.match(requiredHeader(dashboard, 'content-security-policy'), /default-src 'none'/);
  assert.match(requiredHeader(dashboard, 'content-security-policy'), /script-src 'self'/);

  const adminClient = await fetch(`${baseUrl}/admin.js`).then((response) => response.text());
  assert.match(adminClient, /admin-view/);
  assert.match(adminClient, /refetchInterval/);

  const activeSessions = await fetch(`${baseUrl}/admin/?view=sessions&state=active`, { headers: authHeaders }).then((response) => response.text());
  assert.match(activeSessions, /<h1[^>]*>Sessions<\/h1>/);
  assert.match(activeSessions, /Active sessions/);
  assert.match(activeSessions, /Past <b>/);
  assert.match(activeSessions, /Page 1 of (?:[2-9]|[1-9]\d+)/);

  const secondSessionPage = await fetch(`${baseUrl}/admin/?view=sessions&state=active&page=2`, { headers: authHeaders }).then((response) => response.text());
  assert.match(secondSessionPage, /Page 2 of (?:[2-9]|[1-9]\d+)/);

  const pastSessions = await fetch(`${baseUrl}/admin/?view=sessions&state=past`, { headers: authHeaders }).then((response) => response.text());
  assert.match(pastSessions, /Past sessions/);
  assert.match(pastSessions, new RegExp(closedRoom.roomId));

  const participants = await fetch(`${baseUrl}/admin/?view=participants`, { headers: authHeaders }).then((response) => response.text());
  assert.match(participants, /<h1[^>]*>Participants<\/h1>/);
  assert.match(participants, /Page 1 of (?:[2-9]|[1-9]\d+)/);

  const participantData = await fetch(`${baseUrl}/admin/data?view=participants&page=2`, { headers: authHeaders }).then((response) => response.json());
  assert.equal(participantData.view, 'participants');
  assert.equal(participantData.title, 'Participants');
  assert.match(participantData.content, /Page 2 of/);

  const signals = await fetch(`${baseUrl}/admin/?view=signals`, { headers: authHeaders }).then((response) => response.text());
  assert.match(signals, /<h1[^>]*>WebRTC signals<\/h1>/);
  assert.match(signals, /Signaling payload contents are masked/);
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

  const unauthorized = await roomRequest(`/${host.roomId}/signals?after=0`);
  assert.equal(unauthorized.status, 401);
});
