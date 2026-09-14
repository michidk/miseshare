import '@tanstack/react-start/server-only'
import { getRequestIP } from 'h3'
import { defineHandler } from 'nitro'
import { secureResponse } from './http.server'
import { getServerRuntime } from './runtime.server'

export default defineHandler(async (event) => {
  const startedAt = performance.now()
  const runtime = await getServerRuntime()
  const clientIdentity =
    getRequestIP(event, { xForwardedFor: runtime.environment.trustProxy }) ?? 'unknown'
  return secureResponse(
    event.req,
    await runtime.roomApi.handleRequest(event.req, clientIdentity),
    startedAt,
  )
})
