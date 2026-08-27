import type { NativeVideoSettings, TextCodecSettings } from '../media/index.js';

export type RoomStreamSettings = TextCodecSettings | NativeVideoSettings;

export type ActivityKind = 'joined' | 'left' | 'stream-started' | 'stream-stopped' | 'audio' | 'settings';

export interface PresenterInfo {
  id: string;
  name: string;
  isHost: boolean;
  audioEnabled: boolean;
  settings: RoomStreamSettings;
}

export interface ParticipantInfo {
  id: string;
  name: string;
  isHost: boolean;
}

export interface ChatMessage {
  type: 'chat';
  id: string;
  sender: 'host' | 'viewer';
  senderId: string;
  author: string;
  text: string;
  sentAt: number;
}

export interface ChatActivity {
  type: 'chat-activity';
  id: string;
  activity: ActivityKind;
  author: string;
  text: string;
  occurredAt: number;
}

export type ChatEntry = ChatMessage | ChatActivity;

export type HostRoomMessage =
  | { type: 'room-full' }
  | { type: 'room-closed' }
  | { type: 'kicked' }
  | { type: 'accepted'; name: string; hostId: string }
  | { type: 'chat-history'; messages: ChatEntry[] }
  | ChatEntry
  | { type: 'participant-count'; participantCount: number }
  | { type: 'room-state'; presenters: PresenterInfo[]; participants: ParticipantInfo[] }
  | { type: 'stream-started' | 'stream-settings' | 'stream-audio'; presenter: PresenterInfo }
  | { type: 'stream-stopped'; presenterId: string }
  | { type: 'share-approved'; participants: string[] }
  | { type: 'participant-joined'; participant: ParticipantInfo }
  | { type: 'participant-left'; peerId: string };

export type ViewerRoomMessage =
  | { type: 'stream-started'; streamSettings?: RoomStreamSettings; audioEnabled: boolean }
  | { type: 'stop-presenting' }
  | { type: 'settings-changed' | 'settings-selected'; streamSettings: RoomStreamSettings }
  | { type: 'audio-changed'; audioEnabled: boolean }
  | { type: 'chat'; text: string };

export type RoomRole = 'none' | 'host' | 'viewer';
export type RoomConnectionState = 'idle' | 'connecting' | 'live' | 'ended';

export interface RoomSessionSnapshot {
  role: RoomRole;
  connection: RoomConnectionState;
  roomId: string;
  hostId: string;
  viewerName: string;
  presentationPending: boolean;
  participantCount: number;
}
