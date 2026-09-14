export type SignalKind = 'description' | 'candidate';

export interface RoomParticipant {
  id: string;
  name: string;
  isHost: boolean;
}

export interface RoomCredentials {
  roomId: string;
  participant: RoomParticipant;
  participantToken: string;
  hostId: string;
  participants: RoomParticipant[];
}

export interface SignalEnvelope {
  id: number;
  senderId: string;
  recipientId: string;
  kind: SignalKind;
  payload: unknown;
}

export interface OutgoingSignal {
  recipientId: string;
  kind: SignalKind;
  payload: unknown;
}

export type RtcTelemetry =
  | {
      type: 'connection-state';
      peerId: string;
      state: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed' | 'recovering';
    }
  | { type: 'connection-route'; peerId: string; route: 'direct' | 'relay' | 'unknown' };

export interface CreateRoomRequest {
  password?: string;
}

export interface JoinRoomRequest {
  password?: string;
}

export interface SignalBatch {
  signals: SignalEnvelope[];
  cursor: number;
}
