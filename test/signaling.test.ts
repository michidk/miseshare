import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RestSignalingSession } from '../src/signaling/index.js';

test('browser departure uses an independent keepalive request for a viewer', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), init };
    return new Response(null, { status: 204 });
  };
  const session = new RestSignalingSession('/api', {
    roomId: 'room-test',
    participant: { id: 'guest-12345', name: 'Guest', isHost: false },
    participantToken: 'secret',
    hostId: 'host-12345',
    participants: [],
  });

  session.depart();
  await Promise.resolve();

  assert.equal(request?.url, '/api/rooms/room-test/participants/me');
  assert.equal(request?.init?.method, 'DELETE');
  assert.equal(request?.init?.keepalive, true);
  assert.equal(request?.init?.signal, undefined);
});

test('browser departure closes the room when the host leaves', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let url = '';
  globalThis.fetch = async (input) => {
    url = String(input);
    return new Response(null, { status: 204 });
  };
  const session = new RestSignalingSession('/api', {
    roomId: 'room-test',
    participant: { id: 'host-12345', name: 'Host', isHost: true },
    participantToken: 'secret',
    hostId: 'host-12345',
    participants: [],
  });

  session.depart();
  await Promise.resolve();

  assert.equal(url, '/api/rooms/room-test');
});
