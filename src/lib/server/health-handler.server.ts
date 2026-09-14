import '@tanstack/react-start/server-only'
import { defineHandler } from 'nitro'
import { secureResponse } from './http.server'
import { getServerRuntime } from './runtime.server'

export default defineHandler(async (event) => {
  const startedAt = performance.now()
  const pathname = new URL(event.req.url).pathname.replace(/\/$/, '')
  if (pathname.endsWith('/health/live')) {
    return secureResponse(event.req, Response.json({ ok: true }), startedAt)
  }

  try {
    const runtime = await getServerRuntime()
    await runtime.roomApi.healthCheck()
    return secureResponse(event.req, Response.json({ ok: true }), startedAt)
  } catch (error) {
    console.error(
      JSON.stringify({
        type: 'readiness-failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    )
    return secureResponse(event.req, Response.json({ ok: false }, { status: 503 }), startedAt)
  }
})
