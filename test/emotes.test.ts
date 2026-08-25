import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEmoteService } from '../src/emotes/index.js';
import { buildTwitchCatalogSource } from '../src/emotes/internal/service.js';

test('native Twitch emotes load from the credential-free aggregate catalog', async () => {
  const source = buildTwitchCatalogSource(async () => Response.json([
    {
      provider: 0,
      code: 'Kappa',
      urls: [
        { size: '2x', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/light/2.0' },
        { size: '1x', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/light/1.0' },
      ],
    },
    { provider: 0, code: 'unsafe', urls: [{ size: '1x', url: 'https://example.com/emote.png' }] },
  ]));

  assert.deepEqual(await source.load(), [{
    name: 'Kappa',
    sourceUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/light/1.0',
    provider: 'twitch',
    animated: false,
  }]);
});

test('emote catalogs expose only same-origin proxy URLs', async () => {
  const service = buildEmoteService({
    sources: [{
      load: async () => [{
        name: 'wave',
        sourceUrl: 'https://cdn.7tv.app/emote/example/1x.webp',
        provider: '7tv' as const,
        animated: false,
      }],
    }],
    assetFetch: async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'image/webp', 'content-length': '3' },
    }),
    now: () => 1_000,
  });

  const catalog = await service.catalog('/preview/emotes/assets');
  assert.equal(catalog.length, 1);
  assert.match(catalog[0].url, /^\/preview\/emotes\/assets\/[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(catalog).includes('cdn.7tv.app'), false);
  const id = catalog[0].url.split('/').at(-1) ?? '';
  assert.deepEqual(await service.asset(id), { contentType: 'image/webp', data: new Uint8Array([1, 2, 3]) });
});

test('emote proxy rejects unsupported content types', async () => {
  const service = buildEmoteService({
    sources: [{
      load: async () => [{
        name: 'bad',
        sourceUrl: 'https://cdn.7tv.app/emote/example/1x.webp',
        provider: '7tv' as const,
        animated: false,
      }],
    }],
    assetFetch: async () => new Response('<script>alert(1)</script>', {
      headers: { 'content-type': 'text/html' },
    }),
  });
  const [emote] = await service.catalog('/emotes/assets');
  assert.equal(await service.asset(emote.url.split('/').at(-1) ?? ''), undefined);
});

test('emote proxy does not follow redirects outside approved provider hosts', async () => {
  const fetched: string[] = [];
  const service = buildEmoteService({
    sources: [{
      load: async () => [{
        name: 'redirect',
        sourceUrl: 'https://cdn.7tv.app/emote/example/1x.webp',
        provider: '7tv' as const,
        animated: false,
      }],
    }],
    assetFetch: async (url) => {
      fetched.push(url);
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
    },
  });
  const [emote] = await service.catalog('/emotes/assets');

  assert.equal(await service.asset(emote.url.split('/').at(-1) ?? ''), undefined);
  assert.deepEqual(fetched, ['https://cdn.7tv.app/emote/example/1x.webp']);
});

test('emote proxy rejects streamed assets larger than one MiB', async () => {
  const service = buildEmoteService({
    sources: [{
      load: async () => [{
        name: 'huge',
        sourceUrl: 'https://cdn.7tv.app/emote/example/1x.webp',
        provider: '7tv' as const,
        animated: false,
      }],
    }],
    assetFetch: async () => new Response(new Uint8Array(1024 * 1024 + 1), {
      headers: { 'content-type': 'image/webp' },
    }),
  });
  const [emote] = await service.catalog('/emotes/assets');
  assert.equal(await service.asset(emote.url.split('/').at(-1) ?? ''), undefined);
});
