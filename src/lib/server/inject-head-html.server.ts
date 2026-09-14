import '@tanstack/react-start/server-only'

const HEAD_END_TAG = '</head>'
const HEAD_END_TAG_OVERLAP = HEAD_END_TAG.length - 1

export function injectHeadHtml(response: Response, headHtml?: string): Response {
  if (!headHtml || !isInjectableHtmlResponse(response)) return response

  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new Response(response.body.pipeThrough(createHeadInjectionStream(headHtml)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function isInjectableHtmlResponse(response: Response): response is Response & {
  body: ReadableStream<Uint8Array>
} {
  return (
    response.body !== null &&
    response.headers.get('content-type')?.toLowerCase().includes('text/html') === true &&
    !response.headers.has('content-encoding')
  )
}

function createHeadInjectionStream(headHtml: string) {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let pending = ''
  let injected = false

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true })
      flush(controller)
    },
    flush(controller) {
      pending += decoder.decode()
      flush(controller, true)
    },
  })

  function flush(controller: TransformStreamDefaultController<Uint8Array>, final = false) {
    if (injected) {
      if (pending) controller.enqueue(encoder.encode(pending))
      pending = ''
      return
    }
    const headEndIndex = pending.toLowerCase().indexOf(HEAD_END_TAG)
    if (headEndIndex >= 0) {
      pending = `${pending.slice(0, headEndIndex)}${headHtml}${pending.slice(headEndIndex)}`
      injected = true
      controller.enqueue(encoder.encode(pending))
      pending = ''
      return
    }
    if (final) {
      if (pending) controller.enqueue(encoder.encode(pending))
      pending = ''
      return
    }
    const safeLength = Math.max(0, pending.length - HEAD_END_TAG_OVERLAP)
    if (!safeLength) return
    controller.enqueue(encoder.encode(pending.slice(0, safeLength)))
    pending = pending.slice(safeLength)
  }
}
