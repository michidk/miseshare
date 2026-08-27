import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DROP_FILE_SIZE, P2pDrop, type DropTransferUpdate } from '../src/drop/index.js';
import type { ChannelEvent, RtcChannel } from '../src/rtc/index.js';

test('a file is offered, accepted, and reconstructed over a peer channel', async () => {
  const [senderChannel, receiverChannel] = channelPair('receiver-peer', 'sender-peer');
  senderChannel.bufferedAmount = 2 * 1024 * 1024;
  const senderUpdates: DropTransferUpdate[] = [];
  let resolveReceived: ((transfer: DropTransferUpdate) => void) | undefined;
  const received = new Promise<DropTransferUpdate>((resolve) => { resolveReceived = resolve; });
  const sender = new P2pDrop({ update: (transfer) => senderUpdates.push(transfer) });
  const receiver = new P2pDrop({
    update: (transfer) => {
      if (transfer.status === 'offered') receiver.accept(transfer.peerId, transfer.id);
      if (transfer.status === 'completed') resolveReceived?.(transfer);
    },
  });
  sender.registerPeer('receiver-peer', senderChannel);
  receiver.registerPeer('sender-peer', receiverChannel);

  const contents = Uint8Array.from({ length: 100_000 }, (_, index) => index % 251);
  sender.offer(new File([contents], 'notes.bin', { type: 'application/octet-stream' }));
  assert.equal(senderUpdates.at(-1)?.status, 'sending');
  assert.equal(senderUpdates.some((transfer) => transfer.status === 'completed'), false);
  senderChannel.bufferedAmount = 0;
  senderChannel.emit('drain');
  const complete = await received;

  assert.equal(complete.name, 'notes.bin');
  assert.equal(complete.mimeType, 'application/octet-stream');
  const blob = complete.blob;
  assert.ok(blob);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), contents);
  assert.ok(senderUpdates.some((transfer) => transfer.status === 'sending'));
  assert.equal(senderUpdates.at(-1)?.status, 'completed');
});

test('declining an offer ends the sender transfer without sending file bytes', async () => {
  const [senderChannel, receiverChannel] = channelPair('receiver-peer', 'sender-peer');
  let final: DropTransferUpdate | undefined;
  const sender = new P2pDrop({ update: (transfer) => { final = transfer; } });
  const receiver = new P2pDrop({
    update: (transfer) => {
      if (transfer.status === 'offered') receiver.decline(transfer.peerId, transfer.id);
    },
  });
  sender.registerPeer('receiver-peer', senderChannel);
  receiver.registerPeer('sender-peer', receiverChannel);

  sender.offer(new File(['no thanks'], 'declined.txt'));
  await Promise.resolve();
  assert.equal(final?.status, 'declined');
  assert.equal(final?.transferred, 0);
});

test('files larger than the in-memory safety limit are rejected', () => {
  const drop = new P2pDrop();
  const oversized = { name: 'huge.bin', size: MAX_DROP_FILE_SIZE + 1, type: '', slice: () => new Blob() } as File;
  assert.throws(() => drop.offer(oversized), /no larger than 256 MB/i);
});

class FakeChannel implements RtcChannel {
  readonly listeners = new Map<ChannelEvent, Set<(value?: unknown) => void>>();
  counterpart?: FakeChannel;
  open = true;
  bufferedAmount = 0;

  constructor(readonly peerId: string) {}

  send(value: unknown) {
    if (!this.open || !this.counterpart?.open) throw new Error('closed');
    this.counterpart.emit('message', value);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  on(event: ChannelEvent, listener: (value?: unknown) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: ChannelEvent, listener: (value?: unknown) => void) {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: ChannelEvent, value?: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
}

function channelPair(firstPeerId: string, secondPeerId: string): [FakeChannel, FakeChannel] {
  const first = new FakeChannel(firstPeerId);
  const second = new FakeChannel(secondPeerId);
  first.counterpart = second;
  second.counterpart = first;
  return [first, second];
}
