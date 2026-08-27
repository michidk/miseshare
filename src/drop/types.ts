export const MAX_DROP_FILE_SIZE = 256 * 1024 * 1024;

export type DropTransferStatus =
  | 'offered'
  | 'waiting'
  | 'sending'
  | 'receiving'
  | 'completed'
  | 'declined'
  | 'cancelled'
  | 'error';

export interface DropTransferUpdate {
  id: string;
  peerId: string;
  direction: 'incoming' | 'outgoing';
  name: string;
  mimeType: string;
  size: number;
  transferred: number;
  status: DropTransferStatus;
  error?: string;
  blob?: Blob;
}

export interface DropEvents {
  update(transfer: DropTransferUpdate): void;
}
