import { Router, type Request, type RequestHandler } from 'express';
import type { CreateRoomRequest, JoinRoomRequest, OutgoingSignal } from '../../signaling/index.js';
import { RoomApiError, RoomService } from './service.js';

export function buildRoomRouter(service: RoomService) {
  const router = Router();
  router.use(Router().use((request, response, next) => {
    if (!request.is('application/json') && ['POST', 'PUT', 'PATCH'].includes(request.method)) {
      response.status(415).json({ error: { code: 'json-required', message: 'Requests must use application/json.' } });
      return;
    }
    next();
  }));

  router.post('/', route(async (request, response) => {
    await service.enforceRateLimit('room-create', clientIdentity(request), { limit: 60, windowMs: 60_000 });
    response.status(201).json(await service.createRoom((request.body ?? {}) as CreateRoomRequest));
  }));
  router.post('/:roomId/join', route(async (request, response) => {
    const id = roomId(request);
    await service.enforceRateLimit(`room-join:${id}`, clientIdentity(request), { limit: 20, windowMs: 5 * 60_000 });
    response.status(201).json(await service.joinRoom(id, (request.body ?? {}) as JoinRoomRequest));
  }));
  router.post('/:roomId/heartbeat', route(async (request, response) => {
    const identity = requireIdentity(request);
    await service.heartbeat(roomId(request), identity.participantId, identity.token);
    response.status(204).end();
  }));
  router.delete('/:roomId', route(async (request, response) => {
    const identity = requireIdentity(request);
    await service.closeRoom(roomId(request), identity.participantId, identity.token);
    response.status(204).end();
  }));
  router.delete('/:roomId/participants/me', route(async (request, response) => {
    const identity = requireIdentity(request);
    await service.leaveRoom(roomId(request), identity.participantId, identity.token);
    response.status(204).end();
  }));
  router.delete('/:roomId/participants/:participantId', route(async (request, response) => {
    const identity = requireIdentity(request);
    await service.kickParticipant(roomId(request), identity.participantId, identity.token, participantId(request));
    response.status(204).end();
  }));
  router.post('/:roomId/signals', route(async (request, response) => {
    const identity = requireIdentity(request);
    await service.enforceRateLimit('signal-send', `${clientIdentity(request)}:${identity.participantId}`, { limit: 600, windowMs: 60_000 });
    await service.sendSignal(roomId(request), identity.participantId, identity.token, outgoingSignal(request.body));
    response.status(202).end();
  }));
  router.get('/:roomId/signals', route(async (request, response) => {
    const identity = requireIdentity(request);
    const after = signalCursor(request.query.after);
    response.set('Cache-Control', 'private, no-store');
    response.json(await service.readSignals(roomId(request), identity.participantId, identity.token, after));
  }));
  return router;
}

function requireIdentity(request: Request) {
  const participantId = request.header('x-participant-id') ?? '';
  const authorization = request.header('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!participantId || !token) throw new RoomApiError('unauthorized', 401, 'Room credentials are required.');
  return { participantId, token };
}

function clientIdentity(request: Request) {
  return request.ip || request.socket.remoteAddress || 'unknown';
}

function roomId(request: Request) {
  const value = request.params.roomId;
  const id = Array.isArray(value) ? value[0] ?? '' : value;
  if (!/^[a-z2-9]{4}-[a-z2-9]{4}$/.test(id)) throw new RoomApiError('room-unavailable', 404, 'This room is no longer available.');
  return id;
}

function participantId(request: Request) {
  const value = request.params.participantId;
  const id = Array.isArray(value) ? value[0] ?? '' : value;
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) throw new RoomApiError('room-unavailable', 404, 'This participant is no longer available.');
  return id;
}

function outgoingSignal(value: unknown): OutgoingSignal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RoomApiError('invalid-signal', 400, 'The signaling message is invalid.');
  }
  const signal = value as Record<string, unknown>;
  if (typeof signal.recipientId !== 'string' || (signal.kind !== 'description' && signal.kind !== 'candidate')
    || signal.payload === undefined) {
    throw new RoomApiError('invalid-signal', 400, 'The signaling message is invalid.');
  }
  return {
    recipientId: signal.recipientId,
    kind: signal.kind,
    payload: signal.payload,
  };
}

function signalCursor(value: unknown) {
  if (value === undefined) return 0;
  const cursor = Number(value);
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new RoomApiError('invalid-cursor', 400, 'The signaling cursor is invalid.');
  return cursor;
}

function route(handler: RequestHandler): RequestHandler {
  return async (request, response, next) => {
    try {
      await handler(request, response, next);
    } catch (error) {
      if (error instanceof RoomApiError) {
        if (error.retryAfterSeconds) response.set('Retry-After', String(error.retryAfterSeconds));
        response.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      console.error(error);
      response.status(500).json({ error: { code: 'internal-error', message: 'The room service failed.' } });
    }
  };
}
