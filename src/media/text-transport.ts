import type { RtcChannel } from '../rtc/index.js';
import {
  LosslessTextRenderer,
  type EncodedTextFrame,
  type RenderableTextFrame,
  type TextFrameChunkPacket,
  type TextFramePacket,
  type TextFrameStartPacket,
  type TextKeyframeRequestPacket,
} from './text-lossless.js';
import type { MediaRenderer } from './pipeline.js';

export const TEXT_TRANSPORT_LIMITS = {
  chunkBytes: 48 * 1024,
  bufferedBytes: 2 * 1024 * 1024,
  queuedMessages: 64,
  compressedFrameBytes: 64 * 1024 * 1024,
  rawFrameBytes: 256 * 1024 * 1024,
  pendingFrameBytes: 64 * 1024 * 1024,
  protocolViolations: 3,
} as const;

interface BroadcasterConnection {
  connection: RtcChannel;
  repairPending: boolean;
  detach(): void;
}

export class TextStreamBroadcaster {
  private readonly connections = new Map<string, BroadcasterConnection>();

  constructor(private readonly onKeyframeRequested: () => void = () => {}) {}

  add(connection: RtcChannel) {
    const opened = () => this.onKeyframeRequested();
    const remove = () => {
      const current = this.connections.get(connection.peerId);
      if (current?.connection === connection) {
        current.detach();
        this.connections.delete(connection.peerId);
      }
    };
    const receive = (value: unknown) => {
      if (!isKeyframeRequest(value)) return;
      entry.repairPending = false;
      this.onKeyframeRequested();
    };
    const entry: BroadcasterConnection = {
      connection,
      repairPending: false,
      detach: () => {
        connection.off('open', opened);
        connection.off('message', receive);
        connection.off('close', remove);
        connection.off('error', remove);
      },
    };
    this.connections.set(connection.peerId, entry);
    connection.on('open', opened);
    connection.on('message', receive);
    connection.on('close', remove);
    connection.on('error', remove);
  }

  has(peerId: string) {
    return this.connections.has(peerId);
  }

  remove(peerId: string, closeConnection = true) {
    const entry = this.connections.get(peerId);
    this.connections.delete(peerId);
    entry?.detach();
    if (closeConnection) entry?.connection.close();
  }

  send(frame: EncodedTextFrame) {
    if (!validEncodedFrame(frame)) return;
    const chunks = splitFrame(frame.data);
    const start: TextFrameStartPacket = {
      type: 'text-frame-start',
      frameId: frame.frameId,
      width: frame.width,
      height: frame.height,
      keyframe: frame.keyframe,
      tileCount: frame.tileCount,
      rawBytes: frame.rawBytes,
      compressedBytes: frame.data.byteLength,
      chunkCount: chunks.length,
    };

    for (const entry of this.connections.values()) {
      const { connection } = entry;
      if (!connection.open || isBackpressured(connection)) {
        this.requestRepair(entry);
        continue;
      }
      if (entry.repairPending && !frame.keyframe) {
        this.onKeyframeRequested();
        continue;
      }
      try {
        connection.send(start);
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
          connection.send({
            type: 'text-frame-chunk',
            frameId: frame.frameId,
            chunkIndex,
            data: chunks[chunkIndex],
          } satisfies TextFrameChunkPacket);
        }
        entry.repairPending = false;
      } catch {
        this.requestRepair(entry);
      }
    }
  }

  close(closeConnections = true) {
    for (const entry of this.connections.values()) {
      entry.detach();
      if (closeConnections) entry.connection.close();
    }
    this.connections.clear();
  }

  private requestRepair(entry: BroadcasterConnection) {
    if (entry.repairPending) return;
    entry.repairPending = true;
    this.onKeyframeRequested();
  }
}

interface PendingFrame extends TextFrameStartPacket {
  chunks: Array<Uint8Array | undefined>;
  receivedBytes: number;
}

export class TextStreamReceiver {
  private readonly renderer: MediaRenderer<RenderableTextFrame>;
  private readonly pending = new Map<number, PendingFrame>();
  private readonly receiveBound = (value: unknown) => this.receive(value);
  private readonly closeBound = () => this.close();
  private renderQueue = Promise.resolve();
  private lastStartedFrameId = 0;
  private generation = 0;
  private violations = 0;
  private awaitingKeyframe = true;
  private repairRequested = false;
  private firstFrameRendered = false;
  private closed = false;

  constructor(
    target: HTMLCanvasElement | MediaRenderer<RenderableTextFrame>,
    private readonly connection: RtcChannel,
    private readonly onFirstFrame: () => void,
  ) {
    this.renderer = isFrameRenderer(target) ? target : new LosslessTextRenderer(target);
    connection.on('message', this.receiveBound);
    connection.on('close', this.closeBound);
    connection.on('error', this.closeBound);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.generation += 1;
    this.pending.clear();
    this.connection.off('message', this.receiveBound);
    this.connection.off('close', this.closeBound);
    this.connection.off('error', this.closeBound);
  }

  private receive(value: unknown) {
    if (this.closed) return;
    const packet = parseTextFramePacket(value);
    if (!packet) {
      if (isKnownPacketType(value)) this.protocolViolation();
      return;
    }
    if (packet.type === 'text-keyframe-request') return;
    if (packet.type === 'text-frame-start') this.startFrame(packet);
    else this.addChunk(packet);
  }

  private startFrame(packet: TextFrameStartPacket) {
    if (packet.frameId <= this.lastStartedFrameId) return this.protocolViolation();
    const hasGap = this.lastStartedFrameId > 0 && packet.frameId !== this.lastStartedFrameId + 1;
    this.lastStartedFrameId = packet.frameId;

    if (hasGap || this.pending.size > 0) this.beginRepair();
    if (this.awaitingKeyframe && !packet.keyframe) {
      this.requestKeyframe();
      return;
    }
    if (packet.keyframe) {
      this.pending.clear();
      this.awaitingKeyframe = false;
      this.repairRequested = false;
    }
    this.pending.set(packet.frameId, { ...packet, chunks: Array(packet.chunkCount), receivedBytes: 0 });
  }

  private addChunk(packet: TextFrameChunkPacket) {
    const frame = this.pending.get(packet.frameId);
    if (!frame) {
      // Frames skipped while awaiting a keyframe, and frames dropped by a
      // repair, still have chunks in flight. Those are expected, so they are
      // discarded instead of counting against the protocol violation budget.
      if (packet.frameId > this.lastStartedFrameId) this.protocolViolation();
      return;
    }
    if (packet.chunkIndex >= frame.chunkCount || frame.chunks[packet.chunkIndex]) {
      this.protocolViolation();
      return;
    }
    const chunk = toUint8Array(packet.data);
    const expectedBytes = packet.chunkIndex === frame.chunkCount - 1
      ? frame.compressedBytes - TEXT_TRANSPORT_LIMITS.chunkBytes * (frame.chunkCount - 1)
      : TEXT_TRANSPORT_LIMITS.chunkBytes;
    if (chunk.byteLength !== expectedBytes
      || frame.receivedBytes + chunk.byteLength > TEXT_TRANSPORT_LIMITS.pendingFrameBytes) {
      this.protocolViolation();
      this.beginRepair();
      return;
    }
    frame.chunks[packet.chunkIndex] = chunk;
    frame.receivedBytes += chunk.byteLength;
    if (frame.chunks.some((candidate) => !candidate)) return;
    this.pending.delete(packet.frameId);
    if (frame.receivedBytes !== frame.compressedBytes) {
      this.protocolViolation();
      this.beginRepair();
      return;
    }

    const generation = this.generation;
    const data = concatenate(frame.chunks as Uint8Array[], frame.compressedBytes);
    this.renderQueue = this.renderQueue.then(async () => {
      if (this.closed || generation !== this.generation) return;
      await this.renderer.render({ ...frame, data });
      if (!this.firstFrameRendered) {
        this.firstFrameRendered = true;
        this.onFirstFrame();
      }
    }).catch(() => this.beginRepair());
  }

  private beginRepair() {
    this.generation += 1;
    this.pending.clear();
    this.awaitingKeyframe = true;
    this.requestKeyframe();
  }

  private requestKeyframe() {
    if (this.repairRequested || !this.connection.open) return;
    this.repairRequested = true;
    this.connection.send({
      type: 'text-keyframe-request',
      afterFrameId: this.lastStartedFrameId,
    } satisfies TextKeyframeRequestPacket);
  }

  private protocolViolation() {
    this.violations += 1;
    if (this.violations < TEXT_TRANSPORT_LIMITS.protocolViolations) return;
    this.close();
    this.connection.close();
  }
}

function parseTextFramePacket(value: unknown): TextFramePacket | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const packet = value as Partial<TextFramePacket>;
  if (packet.type === 'text-frame-start') {
    if (!validInteger(packet.frameId, 1, Number.MAX_SAFE_INTEGER)
      || !validInteger(packet.width, 1, 7680)
      || !validInteger(packet.height, 1, 4320)
      || typeof packet.keyframe !== 'boolean'
      || !validInteger(packet.tileCount, 1, 16_384)
      || !validInteger(packet.rawBytes, 1, TEXT_TRANSPORT_LIMITS.rawFrameBytes)
      || !validInteger(packet.compressedBytes, 1, TEXT_TRANSPORT_LIMITS.compressedFrameBytes)
      || !validInteger(packet.chunkCount, 1, 2048)) return undefined;
    const maximumRawBytes = 2 + packet.tileCount * 8 + packet.width * packet.height * 4;
    const expectedChunks = Math.ceil(packet.compressedBytes / TEXT_TRANSPORT_LIMITS.chunkBytes);
    return packet.rawBytes <= maximumRawBytes && packet.chunkCount === expectedChunks
      ? packet as TextFrameStartPacket
      : undefined;
  }
  if (packet.type === 'text-frame-chunk') {
    if (!validInteger(packet.frameId, 1, Number.MAX_SAFE_INTEGER)
      || !validInteger(packet.chunkIndex, 0, 2047)
      || !(packet.data instanceof Uint8Array || packet.data instanceof ArrayBuffer)
      || packet.data.byteLength < 1 || packet.data.byteLength > TEXT_TRANSPORT_LIMITS.chunkBytes) return undefined;
    return packet as TextFrameChunkPacket;
  }
  if (packet.type === 'text-keyframe-request') {
    return validInteger(packet.afterFrameId, 0, Number.MAX_SAFE_INTEGER)
      ? packet as TextKeyframeRequestPacket
      : undefined;
  }
  return undefined;
}

function isKnownPacketType(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('type' in value)) return false;
  return ['text-frame-start', 'text-frame-chunk', 'text-keyframe-request'].includes(String(value.type));
}

function isKeyframeRequest(value: unknown): value is TextKeyframeRequestPacket {
  return parseTextFramePacket(value)?.type === 'text-keyframe-request';
}

function validEncodedFrame(frame: EncodedTextFrame) {
  return validInteger(frame.frameId, 1, Number.MAX_SAFE_INTEGER)
    && validInteger(frame.width, 1, 7680)
    && validInteger(frame.height, 1, 4320)
    && validInteger(frame.tileCount, 1, 16_384)
    && validInteger(frame.rawBytes, 1, TEXT_TRANSPORT_LIMITS.rawFrameBytes)
    && frame.data.byteLength > 0
    && frame.data.byteLength <= TEXT_TRANSPORT_LIMITS.compressedFrameBytes;
}

function isBackpressured(connection: RtcChannel) {
  return connection.bufferedAmount > TEXT_TRANSPORT_LIMITS.bufferedBytes;
}

function isFrameRenderer(target: HTMLCanvasElement | MediaRenderer<RenderableTextFrame>): target is MediaRenderer<RenderableTextFrame> {
  return 'render' in target && typeof target.render === 'function';
}

function validInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function splitFrame(data: Uint8Array) {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += TEXT_TRANSPORT_LIMITS.chunkBytes) {
    chunks.push(data.slice(offset, offset + TEXT_TRANSPORT_LIMITS.chunkBytes));
  }
  return chunks;
}

function toUint8Array(value: Uint8Array | ArrayBuffer) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function concatenate(chunks: Uint8Array[], byteLength: number) {
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
