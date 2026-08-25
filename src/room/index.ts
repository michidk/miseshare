export { parseHostRoomMessage, parsePresenter, parseStreamSettings, parseTextSettings, parseViewerRoomMessage } from './internal/protocol.js';
export { formatParticipantLabel } from './internal/presentation.js';
export { RoomSession } from './internal/session.js';
export { guestIdentity, guestIdentityCount, guestIdentityWithName, type GuestIdentity } from './internal/guest-identity.js';
export type {
  ActivityKind,
  ChatActivity,
  ChatEntry,
  ChatMessage,
  HostRoomMessage,
  ParticipantInfo,
  PresenterInfo,
  RoomStreamSettings,
  RoomConnectionState,
  RoomRole,
  RoomSessionSnapshot,
  ViewerRoomMessage,
} from './types.js';
