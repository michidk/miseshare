import { unzlib, zlib } from 'fflate';
import type { MediaEncoder, MediaRenderer, StreamSettings } from './pipeline.js';

export const TEXT_CODEC_ID = 'text-lossless-v1' as const;

export interface TextCodecSettings extends StreamSettings {
  codec: typeof TEXT_CODEC_ID;
  frameRate: number;
  compressionLevel: number;
  tileSize: number;
  label: string;
  buttonLabel: string;
}

export interface EncodedTextFrame {
  frameId: number;
  width: number;
  height: number;
  keyframe: boolean;
  tileCount: number;
  rawBytes: number;
  data: Uint8Array;
}

export type RenderableTextFrame = Omit<EncodedTextFrame, 'data'> & { data: Uint8Array };

export interface TextFrameStartPacket {
  type: 'text-frame-start';
  frameId: number;
  width: number;
  height: number;
  keyframe: boolean;
  tileCount: number;
  rawBytes: number;
  compressedBytes: number;
  chunkCount: number;
}

export interface TextFrameChunkPacket {
  type: 'text-frame-chunk';
  frameId: number;
  chunkIndex: number;
  data: Uint8Array | ArrayBuffer;
}

export interface TextKeyframeRequestPacket {
  type: 'text-keyframe-request';
  afterFrameId: number;
}

export type TextFramePacket = TextFrameStartPacket | TextFrameChunkPacket | TextKeyframeRequestPacket;

type FrameListener = (frame: EncodedTextFrame) => void;

/**
 * fflate runs DEFLATE in a blob-URL worker and only forwards failures the
 * worker itself can catch, so a worker that never starts leaves the callback
 * pending forever. The deadline turns that into a rejection the capture loop
 * and the render queue already know how to repair from.
 */
const WORKER_DEADLINE_MS = 10_000;

function withDeadline(work: (settle: (error: Error | null, output: Uint8Array) => void) => void) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('The frame codec worker did not respond.')), WORKER_DEADLINE_MS);
    work((error, output) => {
      window.clearTimeout(timer);
      if (error) reject(error);
      else resolve(output);
    });
  });
}

const compress = (data: Uint8Array, level: number) => withDeadline((settle) => {
  zlib(data, { level: level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }, settle);
});

const decompress = (data: Uint8Array, expectedBytes: number) => withDeadline((settle) => {
  unzlib(data, { size: expectedBytes }, (error, output) => {
    if (!error && output.byteLength !== expectedBytes) settle(new Error('Decoded frame size does not match its metadata.'), output);
    else settle(error, output);
  });
});

/**
 * Captures the browser-provided screen track, finds pixel-exact tile changes,
 * and DEFLATE-compresses those RGBA deltas. The codec intentionally favors
 * static text fidelity over motion; the transport can drop complete frames
 * without corrupting later deltas because the sender periodically keyframes.
 */
export class LosslessTextEncoder implements MediaEncoder<TextCodecSettings> {
  private readonly video = document.createElement('video');
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private previousFrame?: Uint8ClampedArray;
  private timer?: number;
  private frameId = 0;
  private busy = false;
  private stopped = false;
  private lastKeyframeAt = 0;

  constructor(
    private readonly stream: MediaStream,
    private settings: TextCodecSettings,
    private readonly onFrame: FrameListener,
  ) {
    const context = this.canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) throw new Error('Canvas frame processing is unavailable.');
    this.context = context;
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = stream;
  }

  async start() {
    await this.video.play();
    this.schedule(0);
  }

  updateSettings(settings: TextCodecSettings) {
    this.settings = settings;
    this.previousFrame = undefined;
  }

  requestKeyframe() {
    this.previousFrame = undefined;
  }

  stop() {
    this.stopped = true;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.video.pause();
    this.video.srcObject = null;
  }

  private schedule(delay = 1000 / this.settings.frameRate) {
    if (this.stopped) return;
    this.timer = window.setTimeout(() => void this.capture(), delay);
  }

  private async capture() {
    if (this.stopped || this.busy) return this.schedule();
    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    if (!width || !height) return this.schedule(80);

    this.busy = true;
    try {
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.previousFrame = undefined;
      }
      this.context.drawImage(this.video, 0, 0, width, height);
      const pixels = this.context.getImageData(0, 0, width, height).data;
      const now = performance.now();
      const keyframe = !this.previousFrame || now - this.lastKeyframeAt > 15_000;
      const raw = this.encodeChangedTiles(pixels, width, height, keyframe);
      this.previousFrame = pixels.slice();
      if (!raw.tileCount) return;
      if (keyframe) this.lastKeyframeAt = now;
      const data = await compress(raw.data, this.settings.compressionLevel);
      this.onFrame({
        frameId: ++this.frameId,
        width,
        height,
        keyframe,
        tileCount: raw.tileCount,
        rawBytes: raw.data.byteLength,
        data,
      });
    } catch {
      // Repair from the next successful capture rather than continuing a delta chain.
      this.previousFrame = undefined;
    } finally {
      this.busy = false;
      this.schedule();
    }
  }

  private encodeChangedTiles(
    pixels: Uint8ClampedArray,
    frameWidth: number,
    frameHeight: number,
    keyframe: boolean,
  ) {
    const tileSize = this.settings.tileSize;
    const tiles: Array<{ x: number; y: number; width: number; height: number; pixels: Uint8Array }> = [];
    for (let y = 0; y < frameHeight; y += tileSize) {
      for (let x = 0; x < frameWidth; x += tileSize) {
        const width = Math.min(tileSize, frameWidth - x);
        const height = Math.min(tileSize, frameHeight - y);
        if (!keyframe && this.previousFrame && !tileChanged(pixels, this.previousFrame, frameWidth, x, y, width, height)) continue;
        tiles.push({ x, y, width, height, pixels: copyTile(pixels, frameWidth, x, y, width, height) });
      }
    }

    const byteLength = 2 + tiles.reduce((total, tile) => total + 8 + tile.pixels.byteLength, 0);
    const data = new Uint8Array(byteLength);
    const view = new DataView(data.buffer);
    view.setUint16(0, tiles.length, true);
    let offset = 2;
    for (const tile of tiles) {
      view.setUint16(offset, tile.x, true);
      view.setUint16(offset + 2, tile.y, true);
      view.setUint16(offset + 4, tile.width, true);
      view.setUint16(offset + 6, tile.height, true);
      offset += 8;
      data.set(tile.pixels, offset);
      offset += tile.pixels.byteLength;
    }
    return { data, tileCount: tiles.length };
  }
}

export class LosslessTextRenderer implements MediaRenderer<RenderableTextFrame> {
  private readonly context: CanvasRenderingContext2D;
  private latestFrameId = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas rendering is unavailable.');
    this.context = context;
  }

  async render(frame: RenderableTextFrame) {
    if (frame.frameId <= this.latestFrameId) return;
    const decoded = await decompress(frame.data, frame.rawBytes);
    if (frame.frameId <= this.latestFrameId) return;
    if (frame.keyframe || this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.canvas.width = frame.width;
      this.canvas.height = frame.height;
      this.context.fillStyle = '#17191e';
      this.context.fillRect(0, 0, frame.width, frame.height);
    }
    applyTiles(this.context, decoded);
    this.latestFrameId = frame.frameId;
  }
}

function tileChanged(
  current: Uint8ClampedArray,
  previous: Uint8ClampedArray,
  frameWidth: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const rowBytes = width * 4;
  for (let row = 0; row < height; row += 1) {
    const start = ((y + row) * frameWidth + x) * 4;
    for (let offset = 0; offset < rowBytes; offset += 1) {
      if (current[start + offset] !== previous[start + offset]) return true;
    }
  }
  return false;
}

function copyTile(
  pixels: Uint8ClampedArray,
  frameWidth: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const result = new Uint8Array(width * height * 4);
  const rowBytes = width * 4;
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * frameWidth + x) * 4;
    result.set(pixels.subarray(sourceStart, sourceStart + rowBytes), row * rowBytes);
  }
  return result;
}

function applyTiles(context: CanvasRenderingContext2D, payload: Uint8Array) {
  if (payload.byteLength < 2) throw new Error('Text frame is missing its tile count.');
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const tileCount = view.getUint16(0, true);
  let offset = 2;
  for (let index = 0; index < tileCount; index += 1) {
    if (offset + 8 > payload.byteLength) throw new Error('Text frame has a truncated tile header.');
    const x = view.getUint16(offset, true);
    const y = view.getUint16(offset + 2, true);
    const width = view.getUint16(offset + 4, true);
    const height = view.getUint16(offset + 6, true);
    offset += 8;
    const byteLength = width * height * 4;
    if (!width || !height || x + width > context.canvas.width || y + height > context.canvas.height
      || offset + byteLength > payload.byteLength) throw new Error('Text frame contains an invalid tile.');
    const pixels = new Uint8ClampedArray(byteLength);
    pixels.set(payload.subarray(offset, offset + byteLength));
    context.putImageData(new ImageData(pixels, width, height), x, y);
    offset += byteLength;
  }
  if (offset !== payload.byteLength) throw new Error('Text frame contains trailing bytes.');
}
