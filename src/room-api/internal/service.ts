import { createHash } from 'node:crypto';
import type {
  CreateRoomRequest,
  JoinRoomRequest,
  OutgoingSignal,
  RoomCredentials,
  RoomParticipant,
  SignalBatch,
} from '../../signaling/index.js';
import { guestIdentity } from '../../room/index.js';
import { passwordHash, randomToken, tokenHash, verifyPassword } from './crypto.js';
import type { RateLimitPolicy, RoomStore, StoredParticipant } from './types.js';

const ROOM_CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const ROOM_TTL_MS = 90_000;
const MAX_PASSWORD_LENGTH = 128;

export class RoomApiError extends Error {
  constructor(readonly code: string, readonly status: number, message: string, readonly retryAfterSeconds?: number) {
    super(message);
  }
}

export class RoomService {
  constructor(
    private readonly store: RoomStore,
    private readonly now: () => number = Date.now,
    private readonly rateLimiting = true,
  ) {}

  async createRoom(input: CreateRoomRequest): Promise<RoomCredentials> {
    const password = normalizePassword(input.password);
    const roomId = makeRoomId();
    const hostId = makeParticipantId();
    const participantToken = randomToken();
    const now = this.now();
    await this.store.createRoom({
      id: roomId,
      hostId,
      passwordHash: password ? await passwordHash(password) : null,
      expiresAt: now + ROOM_TTL_MS,
      closed: false,
    }, {
      id: hostId,
      roomId,
      name: 'Host',
      tokenHash: tokenHash(participantToken),
      isHost: true,
      lastSeenAt: now,
    });
    return {
      roomId,
      participant: { id: hostId, name: 'Host', isHost: true },
      participantToken,
      hostId,
      participants: [],
    };
  }

  async joinRoom(roomId: string, input: JoinRoomRequest): Promise<RoomCredentials> {
    const room = await this.store.getRoom(roomId);
    const now = this.now();
    if (!room || room.closed || room.expiresAt <= now) throw unavailable();
    const password = normalizePassword(input.password);
    if (room.passwordHash && !password) throw new RoomApiError('password-required', 401, 'This room requires a password.');
    if (room.passwordHash && !await verifyPassword(password, room.passwordHash)) {
      throw new RoomApiError('invalid-password', 401, 'The room password is incorrect.');
    }
    const participantToken = randomToken();
    const participantId = makeParticipantId();
    const participantName = guestIdentity(participantId).name;
    const result = await this.store.joinRoom(roomId, {
      id: participantId,
      roomId,
      name: participantName,
      tokenHash: tokenHash(participantToken),
      isHost: false,
      lastSeenAt: now,
    }, now);
    if (result.status === 'full') throw new RoomApiError('room-full', 409, 'The service has reached its participant capacity.');
    if (result.status === 'unavailable') throw unavailable();
    const participant = { id: participantId, name: result.participant.name, isHost: false };
    return {
      roomId,
      participant,
      participantToken,
      hostId: room.hostId,
      participants: result.participants.map(publicParticipant),
    };
  }

  async heartbeat(roomId: string, participantId: string, token: string) {
    const now = this.now();
    if (!await this.store.heartbeat(roomId, participantId, tokenHash(token), now, now + ROOM_TTL_MS)) throw unavailable();
  }

  async leaveRoom(roomId: string, participantId: string, token: string) {
    if (!await this.store.leaveRoom(roomId, participantId, tokenHash(token))) throw unavailable();
  }

  async kickParticipant(roomId: string, hostId: string, token: string, participantId: string) {
    if (!validParticipantId(participantId) || participantId === hostId
      || !await this.store.kickParticipant(roomId, hostId, tokenHash(token), participantId)) throw unavailable();
  }

  async closeRoom(roomId: string, participantId: string, token: string) {
    if (!await this.store.closeRoom(roomId, participantId, tokenHash(token))) throw unavailable();
  }

  async sendSignal(roomId: string, participantId: string, token: string, signal: OutgoingSignal) {
    const now = this.now();
    await this.requireParticipant(roomId, participantId, token, now);
    if (!validParticipantId(signal.recipientId) || !['description', 'candidate'].includes(signal.kind)
      || signal.payload === undefined || JSON.stringify(signal.payload).length > 128 * 1024) {
      throw new RoomApiError('invalid-signal', 400, 'The signaling message is invalid.');
    }
    if (!await this.store.appendSignal({
      roomId,
      senderId: participantId,
      recipientId: signal.recipientId,
      kind: signal.kind,
      payload: signal.payload,
      now,
    })) throw unavailable();
  }

  async readSignals(roomId: string, participantId: string, token: string, after: number): Promise<SignalBatch> {
    const now = this.now();
    await this.requireParticipant(roomId, participantId, token, now);
    const signals = await this.store.readSignals(roomId, participantId, after, now);
    return { signals, cursor: signals.at(-1)?.id ?? after };
  }

  async enforceRateLimit(scope: string, identity: string, policy: RateLimitPolicy) {
    const result = await this.checkRateLimit(scope, identity, policy);
    if (!result.allowed) {
      throw new RoomApiError('rate-limited', 429, 'Too many requests. Try again shortly.', result.retryAfterSeconds);
    }
    return result;
  }

  async checkRateLimit(scope: string, identity: string, policy: RateLimitPolicy) {
    if (!this.rateLimiting) return { allowed: true, remaining: policy.limit, retryAfterSeconds: 0 };
    const key = createHash('sha256').update(`${scope}\0${identity}`).digest('hex');
    return this.store.consumeRateLimit(key, policy, this.now());
  }

  healthCheck() {
    return this.store.healthCheck();
  }

  private async requireParticipant(roomId: string, participantId: string, token: string, now: number) {
    if (!validParticipantId(participantId) || !token
      || !await this.store.authenticate(roomId, participantId, tokenHash(token), now)) throw unavailable();
  }
}

function publicParticipant(participant: StoredParticipant): RoomParticipant {
  return { id: participant.id, name: participant.name, isHost: participant.isHost };
}

function makeRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const code = Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte & 31]).join('');
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function makeParticipantId() {
  return tokenHash(randomToken(18)).slice(0, 24);
}

function validParticipantId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(value);
}

function normalizePassword(value: unknown) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > MAX_PASSWORD_LENGTH) {
    throw new RoomApiError('invalid-password', 400, 'Room passwords may contain at most 128 characters.');
  }
  return value;
}

function unavailable() {
  return new RoomApiError('room-unavailable', 404, 'This room is no longer available.');
}
