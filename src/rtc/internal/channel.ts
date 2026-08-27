import { decode, encode } from '@msgpack/msgpack';
import type { ChannelEvent, RtcChannel } from '../types.js';

type Listener = ((value: unknown) => void) | (() => void);

export class NativeRtcChannel implements RtcChannel {
  private readonly listeners = new Map<ChannelEvent, Set<Listener>>();

  constructor(readonly peerId: string, private readonly channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 1024 * 1024;
    channel.addEventListener('open', () => this.emit('open'));
    channel.addEventListener('bufferedamountlow', () => this.emit('drain'));
    channel.addEventListener('close', () => this.emit('close'));
    channel.addEventListener('error', () => this.emit('error'));
    channel.addEventListener('message', (event) => {
      try {
        const bytes = event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : event.data instanceof Blob
            ? undefined
            : new Uint8Array(event.data as ArrayBufferLike);
        if (bytes) this.emit('message', decode(bytes));
        else void event.data.arrayBuffer()
          .then((buffer: ArrayBuffer) => this.emit('message', decode(new Uint8Array(buffer))))
          .catch(() => this.emit('error'));
      } catch {
        this.emit('error');
      }
    });
  }

  get open() {
    return this.channel.readyState === 'open';
  }

  get bufferedAmount() {
    return this.channel.bufferedAmount;
  }

  send(value: unknown) {
    if (!this.open) throw new Error('The peer data channel is not open.');
    this.channel.send(encode(value) as Uint8Array<ArrayBuffer>);
  }

  close() {
    this.channel.close();
  }

  on(event: ChannelEvent, listener: Listener) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: ChannelEvent, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: ChannelEvent, value?: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
}
