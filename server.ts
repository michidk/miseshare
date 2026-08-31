import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Response } from 'express';
import { createAdminRouter } from './src/admin.js';
import { buildEmoteService } from './src/emotes/index.js';
import { buildIceServerFactory } from './src/ice-config/index.js';
import { createRoomApi } from './src/room-api/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const configuredMaximum = Number(process.env.MAX_PARTICIPANTS || process.env.MAX_VIEWERS || 12);
const PARTICIPANT_CAPACITY = Number.isSafeInteger(configuredMaximum)
  ? Math.min(12, Math.max(2, configuredMaximum))
  : 12;
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH);
const publicDirectory = path.join(__dirname, 'public');
const indexHtml = readFileSync(path.join(publicDirectory, 'index.html'), 'utf8');
const headHtml = process.env.VITE_HEAD_HTML?.trim();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for room signaling.');
const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) throw new Error('ADMIN_PASSWORD is required.');
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET;
if (!adminSessionSecret) throw new Error('ADMIN_SESSION_SECRET is required.');
if (Buffer.byteLength(adminSessionSecret) < 32) throw new Error('ADMIN_SESSION_SECRET must contain at least 32 bytes.');
const secureCookies = environmentBoolean('SECURE_COOKIES', Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production'));
const requestLogging = environmentBoolean('REQUEST_LOGGING', Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production'));
const iceServerFactory = buildIceServerFactory({
  stunUrls: process.env.STUN_URLS || 'stun:stun.l.google.com:19302',
  turnUrls: process.env.TURN_URLS,
  turnSharedSecret: process.env.TURN_SHARED_SECRET,
  turnTtlSeconds: optionalInteger('TURN_TTL_SECONDS'),
});
const emotes = buildEmoteService({ enabled: environmentBoolean('EMOTES_ENABLED', true) });

const app = express();
app.set('trust proxy', process.env.VERCEL ? 1 : environmentBoolean('TRUST_PROXY', false));
const server = http.createServer(app);
const roomApi = createRoomApi({
  databaseUrl,
  participantCapacity: PARTICIPANT_CAPACITY,
  rateLimiting: environmentBoolean('RATE_LIMIT_ENABLED', true),
});
await roomApi.migrate();

app.disable('x-powered-by');
app.use((_, response, next) => {
  response.set({
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(self), display-capture=(self)',
    'Content-Security-Policy': contentSecurityPolicy(),
  });
  next();
});
app.use((request, response, next) => {
  const requestId = request.header('x-request-id')?.slice(0, 128) || randomUUID();
  const startedAt = performance.now();
  response.set('X-Request-Id', requestId);
  response.once('finish', () => {
    if (!requestLogging && response.statusCode < 500) return;
    console.log(JSON.stringify({
      type: 'http-request',
      requestId,
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    }));
  });
  next();
});

app.use(route('/api/rooms'), express.json({ limit: '192kb' }), roomApi.router);
app.use(route('/admin'), createAdminRouter({
  password: adminPassword,
  sessionSecret: adminSessionSecret,
  basePath: route('/admin'),
  secureCookie: secureCookies,
  rateLimit: (identity) => roomApi.rateLimit('admin-login', identity, { limit: 10, windowMs: 15 * 60_000 }),
  snapshot: (query) => roomApi.adminSnapshot(query),
}));

app.get(route('/health/live'), (_, response) => response.json({ ok: true }));
app.get([route('/health'), route('/health/ready')], async (_, response) => {
  try {
    await roomApi.healthCheck();
    response.json({ ok: true });
  } catch (error) {
    console.error(JSON.stringify({ type: 'readiness-failed', message: errorMessage(error) }));
    response.status(503).json({ ok: false });
  }
});
app.get(route('/config'), (_, response) => {
  response.set('Cache-Control', 'private, no-store');
  response.json({ iceServers: iceServerFactory.create() });
});

app.get(route('/emotes'), async (_, response) => {
  try {
    const catalog = await emotes.catalog(route('/emotes/assets'));
    response.set('Cache-Control', 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400');
    response.json({ emotes: catalog });
  } catch {
    response.set('Cache-Control', 'public, max-age=60');
    response.json({ emotes: [] });
  }
});
app.get(route('/emotes/assets/:assetId'), async (request, response) => {
  const id = Array.isArray(request.params.assetId) ? request.params.assetId[0] : request.params.assetId;
  const asset = await emotes.asset(id ?? '');
  if (!asset) {
    response.status(404).end();
    return;
  }
  response.set({
    'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Type': asset.contentType,
  });
  response.send(Buffer.from(asset.data));
});

app.use(BASE_PATH || '/', express.static(publicDirectory, {
  index: false,
  extensions: ['html'],
  maxAge: 0,
  setHeaders(response, filePath) {
    if (/\.(?:html|js|css)$/.test(filePath)) response.setHeader('Cache-Control', 'no-store');
  },
}));
app.get(route('/'), (_, response) => sendAppHtml(response, './'));
app.get(route('/room/:roomId'), (_, response) => sendAppHtml(response, '../'));

if (!process.env.VERCEL) {
  server.listen(PORT, HOST, () => {
    console.log(`miseshare is ready at http://${HOST}:${PORT}${BASE_PATH || '/'}`);
  });
}

export default server;

function shutdown() {
  server.close(() => void roomApi.close().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function normalizeBasePath(value = ''): string {
  const normalized = String(value).trim().replace(/^\/*|\/*$/g, '');
  return normalized ? `/${normalized}` : '';
}

function route(pathname: string): string {
  return `${BASE_PATH}${pathname}`;
}

function sendAppHtml(response: Response, baseHref: string) {
  response.set('Content-Security-Policy', contentSecurityPolicy(Boolean(headHtml)));
  response.set('Cache-Control', 'no-store');
  response.type('html').send(appHtml(baseHref));
}

function appHtml(baseHref: string): string {
  const html = indexHtml.replace('<base href="/" />', `<base href="${baseHref}" />`);
  if (!headHtml) return html;
  return html.replace('</head>', `${headHtml}\n  </head>`);
}

function contentSecurityPolicy(allowTrustedHeadHtml = false): string {
  const httpsSource = allowTrustedHeadHtml ? ' https:' : '';
  const inlineScriptSource = allowTrustedHeadHtml ? " 'unsafe-inline'" : '';
  return `default-src 'self'; base-uri 'self'; connect-src 'self'${httpsSource}; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:${httpsSource}; media-src 'self' blob:; object-src 'none'; script-src 'self'${httpsSource}${inlineScriptSource}; style-src 'self' 'unsafe-inline'${httpsSource}; worker-src 'self' blob:`;
}

function environmentBoolean(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new Error(`${name} must be a boolean value.`);
}

function optionalInteger(name: string) {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${name} must be an integer.`);
  return number;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
