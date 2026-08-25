import { createHash } from 'node:crypto';
import TwitchEmoticons, { type Emote } from '@mkody/twitch-emoticons';
import type { ChatEmote, EmoteAsset, EmoteProvider, EmoteService } from '../types.js';

const { EmoteFetcher } = TwitchEmoticons;
const CATALOG_TTL_MS = 6 * 60 * 60 * 1_000;
const EMPTY_CATALOG_TTL_MS = 5 * 60 * 1_000;
const ASSET_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_ASSET_BYTES = 1024 * 1024;
const MAX_CACHED_ASSETS = 256;
const PROVIDER_TIMEOUT_MS = 8_000;
const TWITCH_CATALOG_URL = 'https://emotes.adamcy.pl/v1/global/emotes/twitch';
const ALLOWED_ASSET_HOSTS = new Set([
  'cdn.7tv.app',
  'cdn.betterttv.net',
  'cdn.frankerfacez.com',
  'static-cdn.jtvnw.net',
]);
const ALLOWED_CONTENT_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);

interface RenderableEmote extends Emote {
  type: EmoteProvider;
  animated?: boolean;
  modifier?: boolean;
  toLink(size?: number): string;
}

interface RemoteEmote {
  name: string;
  sourceUrl: string;
  provider: EmoteProvider;
  animated: boolean;
}

interface EmoteSource {
  load(): Promise<RemoteEmote[]>;
}

interface EmoteServiceOptions {
  enabled?: boolean;
  sources?: EmoteSource[];
  assetFetch?: (url: string, signal: AbortSignal) => Promise<Response>;
  now?: () => number;
}

export function buildEmoteService(options: EmoteServiceOptions = {}): EmoteService {
  const enabled = options.enabled ?? true;
  const sources = options.sources ?? providerSources();
  const assetFetch = options.assetFetch ?? ((url, signal) => fetch(url, { signal, redirect: 'manual' }));
  const now = options.now ?? Date.now;
  let catalogCache: { emotes: RemoteEmote[]; expiresAt: number } | undefined;
  let loading: Promise<RemoteEmote[]> | undefined;
  const assetsById = new Map<string, RemoteEmote>();
  const assetCache = new Map<string, { asset: EmoteAsset; expiresAt: number }>();

  async function remoteCatalog() {
    if (!enabled) return [];
    if (catalogCache && catalogCache.expiresAt > now()) return catalogCache.emotes;
    if (loading) return loading;
    loading = loadSources(sources).then((emotes) => {
      catalogCache = { emotes, expiresAt: now() + (emotes.length ? CATALOG_TTL_MS : EMPTY_CATALOG_TTL_MS) };
      assetsById.clear();
      for (const emote of emotes) assetsById.set(assetId(emote.sourceUrl), emote);
      return emotes;
    }).finally(() => { loading = undefined; });
    return loading;
  }

  return {
    async catalog(assetBasePath) {
      const emotes = await remoteCatalog();
      return emotes.map(({ name, sourceUrl, provider, animated }): ChatEmote => ({
        name,
        url: `${assetBasePath.replace(/\/$/, '')}/${assetId(sourceUrl)}`,
        provider,
        animated,
      }));
    },
    async asset(id) {
      if (!/^[a-f0-9]{32}$/.test(id)) return undefined;
      const cached = assetCache.get(id);
      if (cached && cached.expiresAt > now()) return cached.asset;
      await remoteCatalog();
      const emote = assetsById.get(id);
      if (!emote || !allowedAssetUrl(emote.sourceUrl)) return undefined;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
      try {
        const response = await fetchAsset(emote.sourceUrl, controller.signal, assetFetch);
        if (!response?.ok || !allowedAssetUrl(response.url || emote.sourceUrl)) return undefined;
        const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
        if (!ALLOWED_CONTENT_TYPES.has(contentType)) return undefined;
        const declaredLength = Number(response.headers.get('content-length') ?? '0');
        if (declaredLength > MAX_ASSET_BYTES) return undefined;
        const data = await readLimitedBody(response);
        if (!data?.length) return undefined;
        const asset = { contentType, data };
        assetCache.set(id, { asset, expiresAt: now() + ASSET_TTL_MS });
        while (assetCache.size > MAX_CACHED_ASSETS) assetCache.delete(assetCache.keys().next().value ?? '');
        return asset;
      } catch {
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

async function loadSources(sources: EmoteSource[]) {
  const results = await Promise.allSettled(sources.map((source) => withTimeout(source.load(), PROVIDER_TIMEOUT_MS)));
  const catalog = new Map<string, RemoteEmote>();
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn(JSON.stringify({ type: 'emote-provider-failed', message: errorMessage(result.reason) }));
      continue;
    }
    for (const emote of result.value) {
      if (emote.name && allowedAssetUrl(emote.sourceUrl)) catalog.set(emote.name, emote);
    }
  }
  return [...catalog.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function providerSources(): EmoteSource[] {
  const fetcher = new EmoteFetcher();
  const providers: Array<[EmoteProvider, () => Promise<Map<string, RenderableEmote>>]> = [
    ['bttv', () => fetcher.fetchBTTVEmotes() as Promise<Map<string, RenderableEmote>>],
    ['ffz', () => fetcher.fetchFFZEmotes() as Promise<Map<string, RenderableEmote>>],
    ['7tv', () => fetcher.fetchSevenTVEmotes() as Promise<Map<string, RenderableEmote>>],
  ];
  return [buildTwitchCatalogSource(), ...providers.map(([provider, load]) => ({
    async load() {
      const emotes = await load();
      return [...emotes.values()].flatMap((emote): RemoteEmote[] => {
        if (emote.modifier || !emote.code) return [];
        const sourceUrl = emote.toLink(1);
        return allowedAssetUrl(sourceUrl) ? [{
          name: emote.code,
          sourceUrl,
          provider,
          animated: emote.animated === true,
        }] : [];
      });
    },
  }))];
}

export function buildTwitchCatalogSource(catalogFetch: typeof fetch = fetch): EmoteSource {
  return {
    async load() {
      const response = await catalogFetch(TWITCH_CATALOG_URL, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`Twitch catalog returned HTTP ${response.status}.`);
      const catalog: unknown = await response.json();
      if (!Array.isArray(catalog)) throw new Error('Twitch catalog returned an invalid response.');
      return catalog.flatMap((value): RemoteEmote[] => {
        if (!value || typeof value !== 'object') return [];
        const candidate = value as { code?: unknown; urls?: unknown };
        if (typeof candidate.code !== 'string' || !candidate.code || !Array.isArray(candidate.urls)) return [];
        const image = candidate.urls.find((url) => url && typeof url === 'object'
          && (url as { size?: unknown }).size === '1x') as { url?: unknown } | undefined;
        if (!image || typeof image.url !== 'string' || !allowedAssetUrl(image.url)) return [];
        return [{ name: candidate.code, sourceUrl: image.url, provider: 'twitch', animated: false }];
      });
    },
  };
}

function assetId(url: string) {
  return createHash('sha256').update(url).digest('hex').slice(0, 32);
}

function allowedAssetUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_ASSET_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

async function fetchAsset(
  initialUrl: string,
  signal: AbortSignal,
  assetFetch: (url: string, signal: AbortSignal) => Promise<Response>,
) {
  let url = initialUrl;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (!allowedAssetUrl(url)) return undefined;
    const response = await assetFetch(url, signal);
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return undefined;
    url = new URL(location, url).href;
  }
  return undefined;
}

async function readLimitedBody(response: Response) {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    byteLength += next.value.byteLength;
    if (byteLength > MAX_ASSET_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(next.value);
  }
  const data = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

function withTimeout<Result>(promise: Promise<Result>, milliseconds: number) {
  return new Promise<Result>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Provider request timed out.')), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
