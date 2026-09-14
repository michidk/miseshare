import '@tanstack/react-start/server-only'
import { getRequestIP } from 'h3'
import { defineHandler } from 'nitro'
import { createAdminHandler } from '@/admin'
import { secureResponse } from './http.server'
import { getServerRuntime } from './runtime.server'

export default defineHandler(async (event) => {
  const startedAt = performance.now()
  const runtime = await getServerRuntime()
  const handler = createAdminHandler({
    password: runtime.environment.adminPassword,
    sessionSecret: runtime.environment.adminSessionSecret,
    basePath: '/admin',
    secureCookie: runtime.environment.secureCookies,
    rateLimit: (identity) =>
      runtime.roomApi.rateLimit('admin-login', identity, {
        limit: 10,
        windowMs: 15 * 60_000,
      }),
    snapshot: (query) => runtime.roomApi.adminSnapshot(query),
  })
  const clientIdentity =
    getRequestIP(event, { xForwardedFor: runtime.environment.trustProxy }) ?? 'unknown'
  return secureResponse(event.req, await handler(event.req, clientIdentity), startedAt)
})
