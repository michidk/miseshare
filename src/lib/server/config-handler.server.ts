import '@tanstack/react-start/server-only'
import { defineHandler } from 'nitro'
import { secureResponse } from './http.server'
import { getServerRuntime } from './runtime.server'

export default defineHandler(async (event) => {
  const startedAt = performance.now()
  const runtime = await getServerRuntime()
  return secureResponse(
    event.req,
    Response.json(
      { iceServers: runtime.iceServers.create() },
      { headers: { 'Cache-Control': 'private, no-store' } },
    ),
    startedAt,
  )
})
