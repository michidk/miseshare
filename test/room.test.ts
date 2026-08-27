import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RoomSession,
  formatParticipantLabel,
  guestIdentity,
  guestIdentityCount,
  parseHostRoomMessage,
  parseViewerRoomMessage,
} from '../src/room/index.js';

test('participant labels do not repeat a host name that already conveys the role', () => {
  assert.equal(formatParticipantLabel('Host', { isHost: true, isLocal: true }), 'Host · You');
  assert.equal(formatParticipantLabel('Morgan', { isHost: true, isSharing: true }), 'Morgan · Host · Sharing');
});

test('guest identities provide a complete stable cycle of funny fake animals', () => {
  const first = guestIdentity('participant-random-id');
  assert.deepEqual(guestIdentity('participant-random-id'), first);
  assert.match(first.name, /^Anonymous [A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.ok(first.emoji.length > 0);
  assert.ok(first.color >= 0 && first.color < 8);
  const names = new Set(Array.from({ length: guestIdentityCount }, (_, attempt) => guestIdentity('participant-random-id', attempt).name));
  assert.equal(guestIdentityCount, 768);
  assert.equal(names.size, guestIdentityCount);
});

test('host protocol carries the authoritative participant names', () => {
  assert.deepEqual(parseHostRoomMessage({
    type: 'participant-joined',
    participant: { id: 'guest-123', name: 'Anonymous Wobbly Bumbleyak', isHost: true },
  }, 'host-room'), {
    type: 'participant-joined',
    participant: { id: 'guest-123', name: 'Anonymous Wobbly Bumbleyak', isHost: false },
  });

  assert.deepEqual(parseHostRoomMessage({
    type: 'room-state',
    presenters: [],
    participants: [{ id: 'host-room', name: 'Host' }, { id: 'guest-123', name: 'Anonymous Wobbly Bumbleyak' }],
  }, 'host-room'), {
    type: 'room-state',
    presenters: [],
    participants: [
      { id: 'host-room', name: 'Host', isHost: true },
      { id: 'guest-123', name: 'Anonymous Wobbly Bumbleyak', isHost: false },
    ],
  });
});

test('host protocol accepts a kicked notification', () => {
  assert.deepEqual(parseHostRoomMessage({ type: 'kicked' }, 'host-room'), { type: 'kicked' });
});

const settings = {
  codec: 'text-lossless-v1',
  frameRate: 6,
  compressionLevel: 6,
  tileSize: 128,
  label: 'Native pixels',
  buttonLabel: 'Lossless text',
};

test('room session enforces explicit host, live, presenting, and ended transitions', () => {
  const session = new RoomSession();
  assert.equal(session.beginPresentation(), false);

  session.startHosting('abcd-2345');
  assert.equal(session.isHost, true);
  assert.equal(session.connection, 'connecting');
  assert.equal(session.beginPresentation(), false);

  assert.equal(session.markLive(), true);
  assert.equal(session.beginPresentation(), true);
  assert.equal(session.beginPresentation(), false);
  session.finishPresentation();
  assert.equal(session.beginPresentation(), true);

  assert.equal(session.end(), true);
  assert.equal(session.presentationPending, false);
  assert.equal(session.beginPresentation(), false);
  assert.equal(session.end(), false);
});

test('host protocol parser returns typed presenters and derives host authority locally', () => {
  const message = parseHostRoomMessage({
    type: 'stream-started',
    presenter: {
      id: 'host-room',
      name: 'Host',
      isHost: false,
      audioEnabled: true,
      settings,
    },
  }, 'host-room');

  assert.equal(message?.type, 'stream-started');
  if (message?.type !== 'stream-started') assert.fail('Expected a stream-started message.');
  assert.equal(message.presenter.isHost, true);
});

test('viewer protocol parser rejects malformed codec settings', () => {
  assert.equal(parseViewerRoomMessage({
    type: 'settings-changed',
    streamSettings: { ...settings, frameRate: Number.NaN },
  }), undefined);

  assert.deepEqual(parseViewerRoomMessage({
    type: 'settings-changed',
    streamSettings: settings,
  }), { type: 'settings-changed', streamSettings: settings });
});

test('room protocol accepts bounded native WebRTC video settings', () => {
  const nativeSettings = {
    codec: 'webrtc-video-v1',
    frameRate: 60,
    width: 1920,
    height: 1080,
    bitrate: 8_000_000,
    compression: 'balanced',
    label: '1080p · 60 fps · balanced compression',
    buttonLabel: '1080p 60 FPS',
  };
  assert.deepEqual(parseViewerRoomMessage({
    type: 'settings-changed',
    streamSettings: nativeSettings,
  }), { type: 'settings-changed', streamSettings: nativeSettings });
  assert.equal(parseViewerRoomMessage({
    type: 'settings-changed',
    streamSettings: { ...nativeSettings, frameRate: 120 },
  }), undefined);
});

test('host protocol parser validates REST-admitted participant identity', () => {
  assert.deepEqual(parseHostRoomMessage({
    type: 'accepted',
    name: 'Guest 1',
    hostId: 'host-room',
  }, 'host-room'), {
    type: 'accepted',
    name: 'Guest 1',
    hostId: 'host-room',
  });

  assert.equal(parseHostRoomMessage({
    type: 'accepted',
    name: 'Guest 1',
    hostId: '',
  }, 'host-room'), undefined);
});
