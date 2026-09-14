import type { Register } from '@tanstack/react-router'
import type { RequestHandler } from '@tanstack/react-start/server'
import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import { contentSecurityPolicy, secureResponse } from '@/lib/server/http.server'
import { injectHeadHtml } from '@/lib/server/inject-head-html.server'

const startHandler = createStartHandler(defaultStreamHandler)

const fetch: RequestHandler<Register> = async (request, options) => {
  const startedAt = performance.now()
  let response = await startHandler(request, options)
  const headHtml = process.env.VITE_HEAD_HTML?.trim()
  response = injectHeadHtml(response, headHtml)

  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  headers.set('Content-Security-Policy', contentSecurityPolicy(Boolean(headHtml)))
  if (/\/room\/[^/]+\/?$/.test(new URL(request.url).pathname)) {
    headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
  }
  response = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })

  return secureResponse(request, response, startedAt)
}

export default { fetch }
