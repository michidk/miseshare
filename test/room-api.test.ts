import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guestIdentity } from '../src/room/index.js';
import { withUniqueGuestName } from '../src/room-api/internal/guest-name.js';
import { roomObservationPayload } from '../src/room-api/internal/observability.js';
import { RoomApiError, RoomService } from '../src/room-api/internal/service.js';
import type { RoomStore, StoredParticipant } from '../src/room-api/internal/types.js';

test('guest name allocation resolves collisions beyond full room capacity', () => {
  const participant = storedParticipant('new-guest', 'unused');
  const existing = Array.from({ length: 12 }, (_, attempt) =>
    storedParticipant(`guest-${attempt}`, guestIdentity(participant.id, attempt).name));

  const assigned = withUniqueGuestName(participant, existing);
  assert.equal(assigned.name, guestIdentity(participant.id, 12).name);
  assert.ok(!existing.some(({ name }) => name === assigned.name));
});

test('signaling storage derives routing identity from the authenticated request', async () => {
  let appended: Parameters<RoomStore['appendSignal']>[0] | undefined;
  const store = {
    authenticate: async () => storedParticipant('real-sender', 'Sender'),
    appendSignal: async (input: Parameters<RoomStore['appendSignal']>[0]) => {
      appended = input;
      return true;
    },
  } as unknown as RoomStore;
  const service = new RoomService(store, () => 1_000);

  await service.sendSignal('real-room', 'real-sender', 'token', {
    recipientId: 'recipient-123',
    kind: 'candidate',
    payload: { candidate: 'candidate:1' },
    roomId: 'forged-room',
    senderId: 'forged-sender',
  } as never);

  assert.deepEqual(appended, {
    roomId: 'real-room',
    senderId: 'real-sender',
    recipientId: 'recipient-123',
    kind: 'candidate',
    payload: { candidate: 'candidate:1' },
    now: 1_000,
  });
});

test('rate limits hash client identities and return a retry interval', async () => {
  let storedKey = '';
  const store = {
    consumeRateLimit: async (key: string) => {
      storedKey = key;
      return { allowed: false, remaining: 0, retryAfterSeconds: 37 };
    },
  } as unknown as RoomStore;
  const service = new RoomService(store, () => 1_000);

  await assert.rejects(
    () => service.enforceRateLimit('room-create', '203.0.113.42', { limit: 1, windowMs: 60_000 }),
    (error) => error instanceof RoomApiError
      && error.status === 429
      && error.code === 'rate-limited'
      && error.retryAfterSeconds === 37,
  );
  assert.match(storedKey, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(storedKey, /203\.0\.113\.42/);
});

test('kicking delegates host identity and target participant to the store', async () => {
  let kicked: Parameters<RoomStore['kickParticipant']> | undefined;
  const store = {
    kickParticipant: async (...input: Parameters<RoomStore['kickParticipant']>) => {
      kicked = input;
      return true;
    },
  } as unknown as RoomStore;
  const service = new RoomService(store);

  await service.kickParticipant('room-test', 'host-12345', 'secret', 'guest-12345');

  assert.deepEqual(kicked?.slice(0, 2), ['room-test', 'host-12345']);
  assert.match(kicked?.[2] ?? '', /^[a-f0-9]{64}$/);
  assert.equal(kicked?.[3], 'guest-12345');
});

test('a participant cannot kick themselves', async () => {
  const store = { kickParticipant: async () => true } as unknown as RoomStore;
  const service = new RoomService(store);
  await assert.rejects(
    () => service.kickParticipant('room-test', 'host-12345', 'secret', 'host-12345'),
    (error) => error instanceof RoomApiError && error.status === 404,
  );
});

test('WebRTC telemetry is authenticated and schema-validated', async () => {
  const observations: unknown[] = [];
  const store = {
    authenticate: async () => storedParticipant('guest-12345', 'Guest'),
  } as unknown as RoomStore;
  const service = new RoomService(store, () => 1_000, false, (event) => observations.push(event));

  await service.recordTelemetry('room-test', 'guest-12345', 'secret', {
    type: 'connection-route',
    peerId: 'host-12345',
    route: 'relay',
  });

  assert.deepEqual(observations, [{
    type: 'connection-route',
    roomId: 'room-test',
    participantId: 'guest-12345',
    peerId: 'host-12345',
    route: 'relay',
  }]);
  await assert.rejects(
    () => service.recordTelemetry('room-test', 'guest-12345', 'secret', {
      type: 'connection-route',
      peerId: 'host-12345',
      route: 'untrusted',
    }),
    (error) => error instanceof RoomApiError && error.code === 'invalid-telemetry',
  );
});

test('observability payloads anonymize connection identifiers and flag TURN usage', () => {
  const payload = roomObservationPayload('test-observability-secret', {
    type: 'connection-route',
    roomId: 'room-test',
    participantId: 'guest-12345',
    peerId: 'host-12345',
    route: 'relay',
  });
  const serialized = JSON.stringify(payload);

  assert.equal(payload.type, 'room-event');
  assert.equal(payload.event, 'connection-route');
  assert.equal(payload.turnUsed, true);
  assert.doesNotMatch(serialized, /room-test|guest-12345|host-12345/);
  assert.match(String(payload.room), /^[a-f0-9]{16}$/);
});

function storedParticipant(id: string, name: string): StoredParticipant {
  return { id, roomId: 'room-test', name, tokenHash: 'token', isHost: false, lastSeenAt: 0 };
}
