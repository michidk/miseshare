import type { RtcChannel } from '../../rtc/index.js';
import {
  MAX_DROP_FILE_SIZE,
  type DropEvents,
  type DropTransferStatus,
  type DropTransferUpdate,
} from '../types.js';

const CHUNK_SIZE = 32 * 1024;
const BUFFER_LIMIT = 1024 * 1024;

interface TransferBase {
  id: string;
  peerId: string;
  name: string;
  mimeType: string;
  size: number;
  transferred: number;
  status: DropTransferStatus;
}

interface OutgoingTransfer extends TransferBase {
  direction: 'outgoing';
  file: File;
}

interface IncomingTransfer extends TransferBase {
  direction: 'incoming';
  chunks: Uint8Array<ArrayBuffer>[];
  nextIndex: number;
}

type ActiveTransfer = OutgoingTransfer | IncomingTransfer;

interface PeerRegistration {
  channel: RtcChannel;
  onMessage: (value: unknown) => void;
  onClose: () => void;
}

type DropMessage =
  | { type: 'drop-offer'; id: string; name: string; mimeType: string; size: number }
  | { type: 'drop-accept' | 'drop-decline' | 'drop-complete' | 'drop-cancel'; id: string }
  | { type: 'drop-chunk'; id: string; index: number; bytes: Uint8Array<ArrayBuffer> };

export class P2pDrop {
  private readonly peers = new Map<string, PeerRegistration>();
  private readonly transfers = new Map<string, ActiveTransfer>();

  constructor(private readonly events: Partial<DropEvents> = {}) {}

  registerPeer(peerId: string, channel: RtcChannel) {
    this.unregisterPeer(peerId);
    const onMessage = (value: unknown) => this.handleMessage(peerId, value);
    const onClose = () => this.unregisterPeer(peerId);
    this.peers.set(peerId, { channel, onMessage, onClose });
    channel.on('message', onMessage);
    channel.on('close', onClose);
    channel.on('error', onClose);
  }

  unregisterPeer(peerId: string) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.channel.off('message', peer.onMessage);
      peer.channel.off('close', peer.onClose);
      peer.channel.off('error', peer.onClose);
      this.peers.delete(peerId);
    }
    for (const [key, transfer] of this.transfers) {
      if (transfer.peerId !== peerId) continue;
      this.transfers.delete(key);
      this.emit({ ...transfer, status: 'error', error: 'The peer disconnected.' });
    }
  }

  clear() {
    for (const peerId of [...this.peers.keys()]) this.unregisterPeer(peerId);
    this.transfers.clear();
  }

  availablePeerIds() {
    return [...this.peers.entries()]
      .filter(([, peer]) => peer.channel.open)
      .map(([peerId]) => peerId);
  }

  offer(file: File, peerIds = this.availablePeerIds()) {
    if (!file.name || file.size < 0 || file.size > MAX_DROP_FILE_SIZE) {
      throw new Error(`Choose a file no larger than ${formatBytes(MAX_DROP_FILE_SIZE)}.`);
    }
    const recipients = [...new Set(peerIds)].filter((peerId) => this.peers.get(peerId)?.channel.open);
    if (!recipients.length) throw new Error('No connected peers are ready to receive a file.');
    const id = transferId();
    let offered = 0;
    for (const peerId of recipients) {
      const transfer: OutgoingTransfer = {
        id,
        peerId,
        direction: 'outgoing',
        file,
        name: safeFileName(file.name),
        mimeType: safeMimeType(file.type),
        size: file.size,
        transferred: 0,
        status: 'waiting',
      };
      this.transfers.set(key(peerId, id), transfer);
      this.emit(transfer);
      try {
        this.peers.get(peerId)?.channel.send({
          type: 'drop-offer',
          id,
          name: transfer.name,
          mimeType: transfer.mimeType,
          size: transfer.size,
        } satisfies DropMessage);
        offered += 1;
      } catch {
        this.transfers.delete(key(peerId, id));
        this.emit({ ...transfer, status: 'error', error: 'The peer disconnected.' });
      }
    }
    if (!offered) throw new Error('No connected peers are ready to receive a file.');
    return { id, recipients: offered };
  }

  accept(peerId: string, id: string) {
    const transfer = this.incoming(peerId, id);
    const channel = this.peers.get(peerId)?.channel;
    if (!transfer || transfer.status !== 'offered' || !channel?.open) return false;
    transfer.status = 'receiving';
    channel.send({ type: 'drop-accept', id } satisfies DropMessage);
    this.emit(transfer);
    return true;
  }

  decline(peerId: string, id: string) {
    const transfer = this.incoming(peerId, id);
    const channel = this.peers.get(peerId)?.channel;
    if (!transfer || transfer.status !== 'offered') return false;
    this.transfers.delete(key(peerId, id));
    if (channel?.open) channel.send({ type: 'drop-decline', id } satisfies DropMessage);
    this.emit({ ...transfer, status: 'declined' });
    return true;
  }

  cancel(peerId: string, id: string) {
    const transfer = this.transfers.get(key(peerId, id));
    if (!transfer) return false;
    this.transfers.delete(key(peerId, id));
    const channel = this.peers.get(peerId)?.channel;
    if (channel?.open) channel.send({ type: 'drop-cancel', id } satisfies DropMessage);
    this.emit({ ...transfer, status: 'cancelled' });
    return true;
  }

  private handleMessage(peerId: string, value: unknown) {
    const message = parseMessage(value);
    if (!message) return;
    if (message.type === 'drop-offer') {
      const transferKey = key(peerId, message.id);
      if (this.transfers.has(transferKey)) return;
      const transfer: IncomingTransfer = {
        id: message.id,
        peerId,
        direction: 'incoming',
        name: message.name,
        mimeType: message.mimeType,
        size: message.size,
        transferred: 0,
        status: 'offered',
        chunks: [],
        nextIndex: 0,
      };
      this.transfers.set(transferKey, transfer);
      this.emit(transfer);
      return;
    }
    const transfer = this.transfers.get(key(peerId, message.id));
    if (!transfer) return;
    if (message.type === 'drop-accept' && transfer.direction === 'outgoing' && transfer.status === 'waiting') {
      transfer.status = 'sending';
      this.emit(transfer);
      void this.sendFile(transfer);
      return;
    }
    if (message.type === 'drop-decline' && transfer.direction === 'outgoing' && transfer.status === 'waiting') {
      this.transfers.delete(key(peerId, message.id));
      this.emit({ ...transfer, status: 'declined' });
      return;
    }
    if (message.type === 'drop-cancel') {
      this.transfers.delete(key(peerId, message.id));
      this.emit({ ...transfer, status: 'cancelled' });
      return;
    }
    if (message.type === 'drop-chunk' && transfer.direction === 'incoming' && transfer.status === 'receiving') {
      this.receiveChunk(transfer, message);
      return;
    }
    if (message.type === 'drop-complete' && transfer.direction === 'incoming' && transfer.status === 'receiving') {
      this.completeIncoming(transfer);
    }
  }

  private async sendFile(transfer: OutgoingTransfer) {
    const transferKey = key(transfer.peerId, transfer.id);
    const channel = this.peers.get(transfer.peerId)?.channel;
    try {
      if (!channel?.open) throw new Error('The peer disconnected.');
      let index = 0;
      for (let offset = 0; offset < transfer.size; offset += CHUNK_SIZE) {
        if (this.transfers.get(transferKey) !== transfer || !channel.open) throw new Error('The transfer was cancelled.');
        await waitForBuffer(channel);
        const bytes = new Uint8Array(await transfer.file.slice(offset, offset + CHUNK_SIZE).arrayBuffer());
        channel.send({ type: 'drop-chunk', id: transfer.id, index, bytes } satisfies DropMessage);
        index += 1;
        transfer.transferred += bytes.byteLength;
        this.emit(transfer);
      }
      if (this.transfers.get(transferKey) !== transfer || !channel.open) throw new Error('The transfer was cancelled.');
      channel.send({ type: 'drop-complete', id: transfer.id } satisfies DropMessage);
      this.transfers.delete(transferKey);
      this.emit({ ...transfer, status: 'completed' });
    } catch (error) {
      if (this.transfers.get(transferKey) !== transfer) return;
      this.transfers.delete(transferKey);
      if (channel?.open) channel.send({ type: 'drop-cancel', id: transfer.id } satisfies DropMessage);
      this.emit({ ...transfer, status: 'error', error: errorMessage(error) });
    }
  }

  private receiveChunk(transfer: IncomingTransfer, message: Extract<DropMessage, { type: 'drop-chunk' }>) {
    if (message.index !== transfer.nextIndex || transfer.transferred + message.bytes.byteLength > transfer.size) {
      this.failIncoming(transfer, 'The incoming file data was invalid.');
      return;
    }
    transfer.chunks.push(message.bytes);
    transfer.nextIndex += 1;
    transfer.transferred += message.bytes.byteLength;
    this.emit(transfer);
  }

  private completeIncoming(transfer: IncomingTransfer) {
    if (transfer.transferred !== transfer.size) {
      this.failIncoming(transfer, 'The incoming file was incomplete.');
      return;
    }
    this.transfers.delete(key(transfer.peerId, transfer.id));
    const blob = new Blob(transfer.chunks, { type: transfer.mimeType });
    this.emit({ ...transfer, chunks: [], status: 'completed', blob });
  }

  private failIncoming(transfer: IncomingTransfer, error: string) {
    this.transfers.delete(key(transfer.peerId, transfer.id));
    const channel = this.peers.get(transfer.peerId)?.channel;
    if (channel?.open) channel.send({ type: 'drop-cancel', id: transfer.id } satisfies DropMessage);
    this.emit({ ...transfer, chunks: [], status: 'error', error });
  }

  private incoming(peerId: string, id: string) {
    const transfer = this.transfers.get(key(peerId, id));
    return transfer?.direction === 'incoming' ? transfer : undefined;
  }

  private emit(transfer: ActiveTransfer | (Omit<DropTransferUpdate, 'blob'> & { blob?: Blob })) {
    this.events.update?.({
      id: transfer.id,
      peerId: transfer.peerId,
      direction: transfer.direction,
      name: transfer.name,
      mimeType: transfer.mimeType,
      size: transfer.size,
      transferred: transfer.transferred,
      status: transfer.status,
      error: 'error' in transfer ? transfer.error : undefined,
      blob: 'blob' in transfer ? transfer.blob : undefined,
    });
  }
}

function parseMessage(value: unknown): DropMessage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const message = value as Record<string, unknown>;
  const id = typeof message.id === 'string' && /^[A-Za-z0-9_-]{12,64}$/.test(message.id) ? message.id : undefined;
  if (!id || typeof message.type !== 'string') return undefined;
  if (message.type === 'drop-offer') {
    const name = typeof message.name === 'string' && message.name.length <= 255 ? safeFileName(message.name) : '';
    const mimeType = typeof message.mimeType === 'string' && message.mimeType.length <= 120 ? safeMimeType(message.mimeType) : '';
    const size = message.size;
    return name && typeof size === 'number' && Number.isSafeInteger(size) && size >= 0 && size <= MAX_DROP_FILE_SIZE
      ? { type: 'drop-offer', id, name, mimeType, size }
      : undefined;
  }
  if (['drop-accept', 'drop-decline', 'drop-complete', 'drop-cancel'].includes(message.type)) {
    return { type: message.type as 'drop-accept' | 'drop-decline' | 'drop-complete' | 'drop-cancel', id };
  }
  if (message.type === 'drop-chunk') {
    const bytes = message.bytes instanceof Uint8Array ? new Uint8Array(message.bytes) : undefined;
    return bytes && bytes.byteLength <= CHUNK_SIZE && Number.isSafeInteger(message.index) && (message.index as number) >= 0
      ? { type: 'drop-chunk', id, index: message.index as number, bytes }
      : undefined;
  }
  return undefined;
}

function waitForBuffer(channel: RtcChannel) {
  if (channel.bufferedAmount <= BUFFER_LIMIT) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      channel.off('drain', onDrain);
      channel.off('close', onClose);
      channel.off('error', onClose);
    };
    const onDrain = () => { cleanup(); resolve(); };
    const onClose = () => { cleanup(); reject(new Error('The peer disconnected.')); };
    channel.on('drain', onDrain);
    channel.on('close', onClose);
    channel.on('error', onClose);
  });
}

function transferId() {
  return crypto.randomUUID().replaceAll('-', '');
}

function key(peerId: string, id: string) {
  return `${peerId}:${id}`;
}

function safeFileName(value: string) {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return character === '/' || character === '\\' || code < 32 || code === 127 ? '_' : character;
    })
    .join('')
    .trim()
    .slice(0, 255);
}

function safeMimeType(value: string) {
  return /^[\w.+-]+\/[\w.+-]+$/.test(value) ? value.slice(0, 120) : 'application/octet-stream';
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'The file transfer failed.';
}

function formatBytes(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
