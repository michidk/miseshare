import '@tanstack/react-start/server-only'
import { randomUUID } from 'node:crypto'

export function secureResponse(
  request: Request,
  response: Response,
  startedAt = performance.now(),
) {
  const headers = new Headers(response.headers)
  const requestId = request.headers.get('x-request-id')?.slice(0, 128) || randomUUID()
  headers.set('X-Request-Id', requestId)
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Permissions-Policy', 'camera=(), microphone=(self), display-capture=(self)')

  const secured = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
  logRequest(request, secured, requestId, startedAt)
  return secured
}

export function contentSecurityPolicy(allowTrustedHeadHtml = false) {
  const httpsSource = allowTrustedHeadHtml ? ' https:' : ''
  return `default-src 'self'; base-uri 'self'; connect-src 'self'${httpsSource}; font-src 'self' https://fonts.gstatic.com data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:${httpsSource}; media-src 'self' blob:; object-src 'none'; script-src 'self' 'unsafe-inline'${httpsSource}; style-src 'self' 'unsafe-inline' https:; worker-src 'self' blob:`
}

function logRequest(request: Request, response: Response, requestId: string, startedAt: number) {
  let enabled = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production')
  const configured = process.env.REQUEST_LOGGING?.trim().toLowerCase()
  if (configured) enabled = ['1', 'true', 'yes', 'on'].includes(configured)
  if (!enabled && response.status < 500) return
  console.log(
    JSON.stringify({
      type: 'http-request',
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      status: response.status,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    }),
  )
}
