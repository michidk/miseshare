import '@tanstack/react-start/server-only'
import { defineHandler } from 'nitro'
import { secureResponse } from './http.server'
import { getServerRuntime } from './runtime.server'

export default defineHandler(async (event) => {
  const startedAt = performance.now()
  const runtime = await getServerRuntime()
  const pathname = new URL(event.req.url).pathname.replace(/\/$/, '')
  const marker = '/emotes/assets/'

  if (pathname.includes(marker)) {
    const id = decodeURIComponent(pathname.slice(pathname.indexOf(marker) + marker.length))
    const asset = await runtime.emotes.asset(id)
    if (!asset) {
      return secureResponse(event.req, new Response(null, { status: 404 }), startedAt)
    }
    return secureResponse(
      event.req,
      new Response(new Blob([asset.data as Uint8Array<ArrayBuffer>]), {
        headers: {
          'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Content-Type': asset.contentType,
        },
      }),
      startedAt,
    )
  }

  try {
    const catalog = await runtime.emotes.catalog('/emotes/assets')
    return secureResponse(
      event.req,
      Response.json(
        { emotes: catalog },
        {
          headers: {
            'Cache-Control': 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400',
          },
        },
      ),
      startedAt,
    )
  } catch {
    return secureResponse(
      event.req,
      Response.json({ emotes: [] }, { headers: { 'Cache-Control': 'public, max-age=60' } }),
      startedAt,
    )
  }
})
