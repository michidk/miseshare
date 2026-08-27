import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RtcChannel } from '../src/rtc/index.js';
import {
  TEXT_TRANSPORT_LIMITS,
  TextStreamBroadcaster,
  TextStreamReceiver,
  type EncodedTextFrame,
  type MediaRenderer,
  type RenderableTextFrame,
  type TextFrameChunkPacket,
  type TextFrameStartPacket,
} from '../src/media/index.js';

type Listener = (...arguments_: any[]) => void;

class FakeConnection implements RtcChannel {
  readonly sent: unknown[] = [];
  readonly listeners = new Map<string, Set<Listener>>();
  open = true;
  bufferedAmount = 0;
  closeCount = 0;

  constructor(readonly peerId = 'peer-1') {}

  on(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  send(value: unknown) {
    this.sent.push(value);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.closeCount += 1;
    this.emit('close');
  }

  emit(event: string, value?: unknown) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(value);
  }

  receive(value: unknown) {
    this.emit('message', value);
  }
}

class RecordingRenderer implements MediaRenderer<RenderableTextFrame> {
  readonly frames: RenderableTextFrame[] = [];

  async render(frame: RenderableTextFrame) {
    this.frames.push(frame);
  }
}

test('broadcaster drops a backpressured frame and requests a repair keyframe', () => {
  const connection = new FakeConnection();
  connection.bufferedAmount = TEXT_TRANSPORT_LIMITS.bufferedBytes + 1;
  let keyframeRequests = 0;
  const broadcaster = new TextStreamBroadcaster(() => { keyframeRequests += 1; });
  broadcaster.add(connection);

  broadcaster.send(encodedFrame(1, false));

  assert.equal(keyframeRequests, 1);
  assert.deepEqual(connection.sent, []);

  connection.bufferedAmount = 0;
  broadcaster.send(encodedFrame(2, true));
  assert.equal((connection.sent[0] as TextFrameStartPacket).type, 'text-frame-start');
  assert.equal((connection.sent[1] as TextFrameChunkPacket).type, 'text-frame-chunk');
});

test('receiver requests a bootstrap keyframe when it attaches to an open channel', () => {
  const connection = new FakeConnection();

  new TextStreamReceiver(new RecordingRenderer(), connection, () => {});

  assert.deepEqual(connection.sent, [{ type: 'text-keyframe-request', afterFrameId: 0 }]);
});

test('receiver requests a bootstrap keyframe when its channel opens later', () => {
  const connection = new FakeConnection();
  connection.open = false;
  new TextStreamReceiver(new RecordingRenderer(), connection, () => {});

  assert.deepEqual(connection.sent, []);
  connection.open = true;
  connection.emit('open');

  assert.deepEqual(connection.sent, [{ type: 'text-keyframe-request', afterFrameId: 0 }]);
});

test('receiver ignores deltas after a frame gap until a keyframe repairs the stream', async () => {
  const connection = new FakeConnection();
  const renderer = new RecordingRenderer();
  let firstFrames = 0;
  new TextStreamReceiver(renderer, connection, () => { firstFrames += 1; });

  sendFrame(connection, 1, true);
  await settle();
  sendStart(connection, 3, false);

  assert.deepEqual(renderer.frames.map(({ frameId }) => frameId), [1]);
  assert.deepEqual(connection.sent, [
    { type: 'text-keyframe-request', afterFrameId: 0 },
    { type: 'text-keyframe-request', afterFrameId: 3 },
  ]);

  sendFrame(connection, 4, true);
  await settle();
  assert.deepEqual(renderer.frames.map(({ frameId }) => frameId), [1, 4]);
  assert.equal(firstFrames, 1);
});

test('receiver serializes asynchronous frame rendering', async () => {
  const connection = new FakeConnection();
  const started: number[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstRender = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const renderer: MediaRenderer<RenderableTextFrame> = {
    async render(frame) {
      started.push(frame.frameId);
      if (frame.frameId === 1) await firstRender;
    },
  };
  new TextStreamReceiver(renderer, connection, () => {});

  sendFrame(connection, 1, true);
  sendFrame(connection, 2, false);
  await settle();
  assert.deepEqual(started, [1]);

  releaseFirst?.();
  await settle();
  assert.deepEqual(started, [1, 2]);
});

test('receiver joining mid-stream repairs instead of closing the peer', async () => {
  const connection = new FakeConnection();
  const renderer = new RecordingRenderer();
  let firstFrames = 0;
  new TextStreamReceiver(renderer, connection, () => { firstFrames += 1; });

  // A codec switch attaches the receiver while the sender is mid-broadcast, so
  // deltas keep arriving until the requested keyframe lands.
  for (let frameId = 10; frameId < 14; frameId += 1) sendFrame(connection, frameId, false);
  await settle();

  assert.equal(connection.closeCount, 0);
  assert.deepEqual(renderer.frames, []);
  assert.deepEqual(connection.sent, [{ type: 'text-keyframe-request', afterFrameId: 0 }]);

  sendFrame(connection, 14, true);
  await settle();
  assert.deepEqual(renderer.frames.map(({ frameId }) => frameId), [14]);
  assert.equal(firstFrames, 1);
});

test('receiver still rejects chunks for a frame that was never announced', () => {
  const connection = new FakeConnection();
  const renderer = new RecordingRenderer();
  new TextStreamReceiver(renderer, connection, () => {});
  const unannounced = {
    type: 'text-frame-chunk',
    frameId: 99,
    chunkIndex: 0,
    data: new Uint8Array([1, 2, 3]),
  } satisfies TextFrameChunkPacket;

  for (let attempt = 0; attempt < TEXT_TRANSPORT_LIMITS.protocolViolations; attempt += 1) connection.receive(unannounced);

  assert.equal(connection.closeCount, 1);
});

test('receiver closes a peer after repeated oversized packets', () => {
  const connection = new FakeConnection();
  const renderer = new RecordingRenderer();
  new TextStreamReceiver(renderer, connection, () => {});
  const oversized = {
    type: 'text-frame-chunk',
    frameId: 1,
    chunkIndex: 0,
    data: new Uint8Array(TEXT_TRANSPORT_LIMITS.chunkBytes + 1),
  };

  for (let attempt = 0; attempt < TEXT_TRANSPORT_LIMITS.protocolViolations; attempt += 1) connection.receive(oversized);

  assert.equal(connection.closeCount, 1);
  assert.deepEqual(renderer.frames, []);
});

function encodedFrame(frameId: number, keyframe: boolean): EncodedTextFrame {
  return { frameId, width: 1, height: 1, keyframe, tileCount: 1, rawBytes: 1, data: new Uint8Array([1, 2, 3]) };
}

function sendStart(connection: FakeConnection, frameId: number, keyframe: boolean, compressedBytes = 3) {
  connection.receive({
    type: 'text-frame-start',
    frameId,
    width: 1,
    height: 1,
    keyframe,
    tileCount: 1,
    rawBytes: 1,
    compressedBytes,
    chunkCount: 1,
  } satisfies TextFrameStartPacket);
}

function sendFrame(connection: FakeConnection, frameId: number, keyframe: boolean) {
  sendStart(connection, frameId, keyframe);
  connection.receive({
    type: 'text-frame-chunk',
    frameId,
    chunkIndex: 0,
    data: new Uint8Array([1, 2, 3]),
  } satisfies TextFrameChunkPacket);
}

function settle() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}
