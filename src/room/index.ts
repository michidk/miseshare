export { parseHostRoomMessage, parseViewerRoomMessage } from './internal/protocol.js';
export { formatParticipantLabel } from './internal/presentation.js';
export { RoomSession } from './internal/session.js';
export { guestIdentity, guestIdentityCount, guestIdentityWithName } from './internal/guest-identity.js';
export type {
  ActivityKind,
  ChatActivity,
  ChatEntry,
  ChatMessage,
  ParticipantInfo,
  PresenterInfo,
  RoomStreamSettings,
} from './types.js';
