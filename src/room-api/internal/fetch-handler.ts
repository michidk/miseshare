import type { CreateRoomRequest, JoinRoomRequest, OutgoingSignal } from '../../signaling'
import { RoomApiError, type RoomService } from './service'

export function buildRoomRequestHandler(service: RoomService) {
  return async (request: Request, clientIdentity: string): Promise<Response> => {
    try {
      return await handleRoomRequest(service, request, clientIdentity)
    } catch (error) {
      if (error instanceof RoomApiError) {
        const headers = error.retryAfterSeconds
          ? { 'Retry-After': String(error.retryAfterSeconds) }
          : undefined
        return Response.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status, headers },
        )
      }
      console.error(error)
      return Response.json(
        { error: { code: 'internal-error', message: 'The room service failed.' } },
        { status: 500 },
      )
    }
  }
}

async function handleRoomRequest(service: RoomService, request: Request, clientIdentity: string) {
  const url = new URL(request.url)
  const pathname = url.pathname.replace(/\/$/, '')
  const relativePath = pathname.slice(pathname.indexOf('/api/rooms') + '/api/rooms'.length)
  const segments = relativePath.split('/').filter(Boolean).map(decodeURIComponent)

  if (request.method === 'POST' && segments.length === 0) {
    requireJson(request)
    await service.enforceRateLimit('room-create', clientIdentity, {
      limit: 60,
      windowMs: 60_000,
    })
    return Response.json(await service.createRoom(await json<CreateRoomRequest>(request)), {
      status: 201,
    })
  }

  const id = validRoomId(segments[0] ?? '')
  if (request.method === 'POST' && segments[1] === 'join' && segments.length === 2) {
    requireJson(request)
    await service.enforceRateLimit(`room-join:${id}`, clientIdentity, {
      limit: 20,
      windowMs: 5 * 60_000,
    })
    return Response.json(await service.joinRoom(id, await json<JoinRoomRequest>(request)), {
      status: 201,
    })
  }

  const identity = requireIdentity(request)
  if (request.method === 'POST' && segments[1] === 'heartbeat' && segments.length === 2) {
    requireJson(request)
    await service.heartbeat(id, identity.participantId, identity.token)
    return new Response(null, { status: 204 })
  }
  if (request.method === 'DELETE' && segments.length === 1) {
    await service.closeRoom(id, identity.participantId, identity.token)
    return new Response(null, { status: 204 })
  }
  if (
    request.method === 'DELETE' &&
    segments[1] === 'participants' &&
    segments[2] === 'me' &&
    segments.length === 3
  ) {
    await service.leaveRoom(id, identity.participantId, identity.token)
    return new Response(null, { status: 204 })
  }
  if (request.method === 'DELETE' && segments[1] === 'participants' && segments.length === 3) {
    await service.kickParticipant(
      id,
      identity.participantId,
      identity.token,
      validParticipantId(segments[2] ?? ''),
    )
    return new Response(null, { status: 204 })
  }
  if (request.method === 'POST' && segments[1] === 'signals' && segments.length === 2) {
    requireJson(request)
    await service.enforceRateLimit('signal-send', `${clientIdentity}:${identity.participantId}`, {
      limit: 600,
      windowMs: 60_000,
    })
    await service.sendSignal(
      id,
      identity.participantId,
      identity.token,
      outgoingSignal(await json(request)),
    )
    return new Response(null, { status: 202 })
  }
  if (request.method === 'GET' && segments[1] === 'signals' && segments.length === 2) {
    return Response.json(
      await service.readSignals(
        id,
        identity.participantId,
        identity.token,
        signalCursor(url.searchParams.get('after')),
      ),
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  return Response.json(
    { error: { code: 'not-found', message: 'The requested room endpoint does not exist.' } },
    { status: 404 },
  )
}

function requireIdentity(request: Request) {
  const participantId = request.headers.get('x-participant-id') ?? ''
  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!participantId || !token) {
    throw new RoomApiError('unauthorized', 401, 'Room credentials are required.')
  }
  return { participantId, token }
}

function requireJson(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new RoomApiError('json-required', 415, 'Requests must use application/json.')
  }
}

async function json<T = unknown>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new RoomApiError('invalid-json', 400, 'The request body is not valid JSON.')
  }
}

function validRoomId(value: string) {
  if (!/^[a-z2-9]{4}-[a-z2-9]{4}$/.test(value)) {
    throw new RoomApiError('room-unavailable', 404, 'This room is no longer available.')
  }
  return value
}

function validParticipantId(value: string) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(value)) {
    throw new RoomApiError('room-unavailable', 404, 'This participant is no longer available.')
  }
  return value
}

function outgoingSignal(value: unknown): OutgoingSignal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RoomApiError('invalid-signal', 400, 'The signaling message is invalid.')
  }
  const signal = value as Record<string, unknown>
  if (
    typeof signal.recipientId !== 'string' ||
    (signal.kind !== 'description' && signal.kind !== 'candidate') ||
    signal.payload === undefined
  ) {
    throw new RoomApiError('invalid-signal', 400, 'The signaling message is invalid.')
  }
  return {
    recipientId: signal.recipientId,
    kind: signal.kind,
    payload: signal.payload,
  }
}

function signalCursor(value: string | null) {
  if (value === null) return 0
  const cursor = Number(value)
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new RoomApiError('invalid-cursor', 400, 'The signaling cursor is invalid.')
  }
  return cursor
}
