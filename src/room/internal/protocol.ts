import {
  NATIVE_VIDEO_CODEC_ID,
  TEXT_CODEC_ID,
  type NativeVideoSettings,
  type TextCodecSettings,
} from '../../media/index.js';
import type {
  ActivityKind,
  ChatActivity,
  ChatEntry,
  ChatMessage,
  HostRoomMessage,
  ParticipantInfo,
  PresenterInfo,
  ViewerRoomMessage,
} from '../types.js';

const ACTIVITY_KINDS = new Set<ActivityKind>(['joined', 'left', 'stream-started', 'stream-stopped', 'audio', 'settings']);

export function parseHostRoomMessage(value: unknown, hostId: string): HostRoomMessage | undefined {
  const message = record(value);
  if (!message || typeof message.type !== 'string') return undefined;
  switch (message.type) {
    case 'room-full':
    case 'room-closed':
    case 'kicked':
      return { type: message.type };
    case 'accepted': {
      const name = boundedString(message.name, 40);
      const acceptedHostId = peerId(message.hostId);
      return name && acceptedHostId
        ? { type: 'accepted', name, hostId: acceptedHostId }
        : undefined;
    }
    case 'chat-history':
      return Array.isArray(message.messages)
        ? { type: 'chat-history', messages: message.messages.slice(-100).flatMap((entry) => parseChatEntry(entry) ?? []) }
        : undefined;
    case 'chat':
      return parseChatMessage(message);
    case 'chat-activity':
      return parseChatActivity(message);
    case 'participant-count':
      return validInteger(message.participantCount, 1, 100)
        ? { type: 'participant-count', participantCount: message.participantCount }
        : undefined;
    case 'room-state':
      return Array.isArray(message.presenters) && Array.isArray(message.participants)
        ? {
            type: 'room-state',
            presenters: message.presenters.flatMap((entry) => parsePresenter(entry, hostId) ?? []),
            participants: message.participants.flatMap((entry) => parseParticipant(entry, hostId) ?? []),
          }
        : undefined;
    case 'stream-started':
    case 'stream-settings':
    case 'stream-audio': {
      const presenter = parsePresenter(message.presenter, hostId);
      return presenter ? { type: message.type, presenter } : undefined;
    }
    case 'stream-stopped': {
      const presenterId = peerId(message.presenterId);
      return presenterId ? { type: 'stream-stopped', presenterId } : undefined;
    }
    case 'share-approved': {
      if (!Array.isArray(message.participants)) return undefined;
      const participants = message.participants.map(peerId).filter((id): id is string => Boolean(id));
      return participants.length === message.participants.length ? { type: 'share-approved', participants } : undefined;
    }
    case 'participant-joined': {
      const participant = parseParticipant(message.participant, hostId);
      return participant ? { type: 'participant-joined', participant } : undefined;
    }
    case 'participant-left': {
      const participantId = peerId(message.peerId);
      return participantId ? { type: 'participant-left', peerId: participantId } : undefined;
    }
    default:
      return undefined;
  }
}

function parseParticipant(value: unknown, hostId: string): ParticipantInfo | undefined {
  const participant = record(value);
  if (!participant) return undefined;
  const id = peerId(participant.id);
  const name = boundedString(participant.name, 40);
  return id && name ? { id, name, isHost: id === hostId } : undefined;
}

export function parseViewerRoomMessage(value: unknown): ViewerRoomMessage | undefined {
  const message = record(value);
  if (!message || typeof message.type !== 'string') return undefined;
  switch (message.type) {
    case 'stream-started':
      return {
        type: 'stream-started',
        streamSettings: parseStreamSettings(message.streamSettings),
        audioEnabled: message.audioEnabled === true,
      };
    case 'stop-presenting':
      return { type: 'stop-presenting' };
    case 'settings-changed':
    case 'settings-selected': {
      const streamSettings = parseStreamSettings(message.streamSettings);
      return streamSettings ? { type: message.type, streamSettings } : undefined;
    }
    case 'audio-changed':
      return typeof message.audioEnabled === 'boolean'
        ? { type: 'audio-changed', audioEnabled: message.audioEnabled }
        : undefined;
    case 'chat': {
      const text = boundedString(message.text, 500);
      return text ? { type: 'chat', text } : undefined;
    }
    default:
      return undefined;
  }
}

export function parsePresenter(value: unknown, hostId: string): PresenterInfo | undefined {
  const presenter = record(value);
  if (!presenter) return undefined;
  const id = peerId(presenter.id);
  const name = boundedString(presenter.name, 40);
  const settings = parseStreamSettings(presenter.settings);
  if (!id || !name || typeof presenter.audioEnabled !== 'boolean' || !settings) return undefined;
  return { id, name, isHost: id === hostId, audioEnabled: presenter.audioEnabled, settings };
}

export function parseTextSettings(value: unknown): TextCodecSettings | undefined {
  const settings = record(value);
  if (!settings || settings.codec !== TEXT_CODEC_ID
    || !validInteger(settings.frameRate, 1, 15)
    || !validInteger(settings.compressionLevel, 0, 9)
    || !validInteger(settings.tileSize, 64, 512)) return undefined;
  const label = boundedString(settings.label, 80);
  const buttonLabel = boundedString(settings.buttonLabel, 40);
  return label && buttonLabel ? {
    codec: TEXT_CODEC_ID,
    frameRate: settings.frameRate,
    compressionLevel: settings.compressionLevel,
    tileSize: settings.tileSize,
    label,
    buttonLabel,
  } : undefined;
}

export function parseStreamSettings(value: unknown): TextCodecSettings | NativeVideoSettings | undefined {
  const text = parseTextSettings(value);
  if (text) return text;
  const settings = record(value);
  if (!settings || settings.codec !== NATIVE_VIDEO_CODEC_ID
    || !validInteger(settings.frameRate, 1, 60)
    || !validInteger(settings.width, 320, 3840)
    || !validInteger(settings.height, 180, 2160)
    || !validInteger(settings.bitrate, 100_000, 50_000_000)
    || !['high', 'balanced', 'low'].includes(String(settings.compression))) return undefined;
  const label = boundedString(settings.label, 80);
  const buttonLabel = boundedString(settings.buttonLabel, 40);
  return label && buttonLabel ? {
    codec: NATIVE_VIDEO_CODEC_ID,
    frameRate: settings.frameRate,
    width: settings.width,
    height: settings.height,
    bitrate: settings.bitrate,
    compression: settings.compression as NativeVideoSettings['compression'],
    label,
    buttonLabel,
  } : undefined;
}

function parseChatEntry(value: unknown): ChatEntry | undefined {
  return parseChatMessage(value) ?? parseChatActivity(value);
}

function parseChatMessage(value: unknown): ChatMessage | undefined {
  const message = record(value);
  if (!message || message.type !== 'chat' || (message.sender !== 'host' && message.sender !== 'viewer')) return undefined;
  const id = boundedString(message.id, 100);
  const senderId = typeof message.senderId === 'string' && message.senderId.length <= 80 ? message.senderId : undefined;
  const author = boundedString(message.author, 40);
  const text = boundedString(message.text, 500);
  if (!id || senderId === undefined || !author || !text || !validTimestamp(message.sentAt)) return undefined;
  return { type: 'chat', id, sender: message.sender, senderId, author, text, sentAt: message.sentAt };
}

function parseChatActivity(value: unknown): ChatActivity | undefined {
  const activity = record(value);
  if (!activity || activity.type !== 'chat-activity' || typeof activity.activity !== 'string'
    || !ACTIVITY_KINDS.has(activity.activity as ActivityKind)) return undefined;
  const id = boundedString(activity.id, 100);
  const author = boundedString(activity.author, 40);
  const text = boundedString(activity.text, 500);
  if (!id || !author || !text || !validTimestamp(activity.occurredAt)) return undefined;
  return { type: 'chat-activity', id, activity: activity.activity as ActivityKind, author, text, occurredAt: activity.occurredAt };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function boundedString(value: unknown, maximumLength: number) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength ? value : undefined;
}

function peerId(value: unknown) {
  return typeof value === 'string' && /^[a-z0-9-]{1,80}$/i.test(value) ? value : undefined;
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
