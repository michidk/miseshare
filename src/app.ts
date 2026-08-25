import { buildChatEmoteRenderer, buildRoomNotificationController } from './chat-ui/index.js';
import {
  createTextPresentation,
  NATIVE_VIDEO_CODEC_ID,
  TEXT_CODEC_ID,
  TextStreamReceiver,
  type NativeVideoSettings,
} from './media/index.js';
import {
  parseHostRoomMessage,
  parseViewerRoomMessage,
  guestIdentity,
  guestIdentityCount,
  guestIdentityWithName,
  RoomSession,
  type ActivityKind,
  type ChatActivity,
  type ChatEntry,
  type ChatMessage,
  type ParticipantInfo,
  type PresenterInfo,
  type RoomStreamSettings,
} from './room/index.js';
import { RtcMesh, type RtcChannel, type RtcPeerChannels } from './rtc/index.js';
import { createRoom, joinRoom as joinSignalingRoom, RestSignalingSession, SignalingError } from './signaling/index.js';

type AppElement = HTMLElement & {
  disabled: boolean;
  select(): void;
  value: string;
};
type ToastTone = 'default' | 'error';
type PresetName = keyof typeof qualityPresets;
type QualityName = PresetName | 'custom';

interface LocalPresentation {
  readonly stream: MediaStream;
  readonly videoTrack: MediaStreamTrack | undefined;
  readonly codec: RoomStreamSettings['codec'];
  start(): Promise<void>;
  updateSettings(settings: RoomStreamSettings): void;
  connect(participantId: string, channel: RtcChannel): void;
  disconnect(participantId: string): void;
  audioTracks(): MediaStreamTrack[];
  setAudioEnabled(enabled: boolean): void;
  stop(stopTracks?: boolean): void;
}

interface ViewerEntry {
  control: RtcChannel;
  name: string;
  lastMessageAt: number;
}

type ConnectivityQuality = 'good' | 'fair' | 'poor';

interface ConnectivityResult {
  status: 'testing' | 'complete' | 'error';
  quality?: ConnectivityQuality;
  pingMs?: number;
  downloadBps?: number;
  uploadBps?: number;
  packetLossPercent?: number;
  route?: 'direct' | 'relay' | 'unknown';
  error?: string;
}

interface PendingConnectivityPing {
  peerId: string;
  startedAt: number;
  resolve: (milliseconds: number) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingConnectivityTransfer {
  peerId: string;
  startedAt?: number;
  bytes: number;
  chunks: number;
  resolve: (bitsPerSecond: number) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface IncomingConnectivityTransfer {
  peerId: string;
  startedAt?: number;
  bytes: number;
  chunks: number;
  timer: ReturnType<typeof setTimeout>;
}

const $ = <ElementType extends Element = AppElement>(selector: string) => {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
};

const landing = $('#landing');
const room = $('#room');
const streamGrid = $('#stream-grid');
const streamsEmpty = $('#streams-empty');
const qualityMenu = $('#quality-menu');
let qualityMenuAnchor: HTMLElement | null = null;
const toast = $('#toast');
const joinPasswordDialog = $<HTMLDialogElement>('#join-password-dialog');
const joinPasswordInput = $<HTMLInputElement>('#join-password');
const joinPasswordError = $('#join-password-error');
const appBaseUrl = new URL(document.baseURI);
const appBasePath = appBaseUrl.pathname.replace(/\/$/, '');
const chatEmoteRenderer = buildChatEmoteRenderer(appPath('emotes'));
const roomNotifications = buildRoomNotificationController($('#notification-toaster'));

const qualityPresets = {
  text: {
    codec: TEXT_CODEC_ID,
    frameRate: 6,
    compressionLevel: 6,
    tileSize: 128,
    label: 'Native resolution · 6 fps · lossless',
    buttonLabel: 'Text',
  },
  '720p': {
    codec: NATIVE_VIDEO_CODEC_ID,
    frameRate: 30,
    width: 1280,
    height: 720,
    bitrate: 2_500_000,
    compression: 'balanced',
    label: '720p · 30 fps · balanced compression',
    buttonLabel: '720p',
  },
  '720p60': {
    codec: NATIVE_VIDEO_CODEC_ID,
    frameRate: 60,
    width: 1280,
    height: 720,
    bitrate: 4_000_000,
    compression: 'balanced',
    label: '720p · 60 fps · balanced compression',
    buttonLabel: '720p 60 FPS',
  },
  '1080p': {
    codec: NATIVE_VIDEO_CODEC_ID,
    frameRate: 30,
    width: 1920,
    height: 1080,
    bitrate: 5_000_000,
    compression: 'balanced',
    label: '1080p · 30 fps · balanced compression',
    buttonLabel: '1080p',
  },
  '1080p60': {
    codec: NATIVE_VIDEO_CODEC_ID,
    frameRate: 60,
    width: 1920,
    height: 1080,
    bitrate: 8_000_000,
    compression: 'balanced',
    label: '1080p · 60 fps · balanced compression',
    buttonLabel: '1080p 60 FPS',
  },
} satisfies Record<string, RoomStreamSettings>;

let mesh: RtcMesh | undefined;
let signaling: RestSignalingSession | undefined;
const session = new RoomSession();
let viewerControl: RtcChannel | undefined;
let localPresentation: LocalPresentation | undefined;
let shareAudioEnabled = false;
let currentStreamSettings: RoomStreamSettings = { ...qualityPresets['720p'] };
let rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: ['stun:main.lohr.dev:3478', 'stun:stun.l.google.com:19302'] }],
};
let chatAudioContext: AudioContext | undefined;
let chatSoundsEnabled = readChatSoundsEnabled();
let chatCollapsed = readChatCollapsed();
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let resolvePasswordPrompt: ((password: string | null) => void) | undefined;

const hostConnections = new Map<string, ViewerEntry>();
const presenters = new Map<string, PresenterInfo>();
const peerChannels = new Map<string, RtcPeerChannels>();
const incomingTextReceivers = new Map<string, TextStreamReceiver>();
const remoteVideoStreams = new Map<string, MediaStream>();
const remoteAudioElements = new Map<string, HTMLAudioElement>();
const mutedPresenters = new Set<string>();
const participantIds = new Set<string>();
const participantNames = new Map<string, string>();
const chatHistory: ChatEntry[] = [];
const connectivityResults = new Map<string, ConnectivityResult>();
const pendingConnectivityPings = new Map<string, PendingConnectivityPing>();
const pendingConnectivityDownloads = new Map<string, PendingConnectivityTransfer>();
const pendingConnectivityUploads = new Map<string, PendingConnectivityTransfer>();
const incomingConnectivityUploads = new Map<string, IncomingConnectivityTransfer>();
const connectivityDownloadResponseAt = new Map<string, number>();
const CONNECTIVITY_PROBE_BYTES = 512 * 1024;
const CONNECTIVITY_CHUNK_BYTES = 32 * 1024;
const CONNECTIVITY_CHUNKS = CONNECTIVITY_PROBE_BYTES / CONNECTIVITY_CHUNK_BYTES;
const CONNECTIVITY_BUFFER_LIMIT = 128 * 1024;
const connectivityProbeChunk = crypto.getRandomValues(new Uint8Array(CONNECTIVITY_CHUNK_BYTES));
let connectivityRun = 0;
let connectivityTesting = false;

const configReady = loadClientConfiguration().catch(() => {});

void chatEmoteRenderer.load()
  .then(rerenderChatEmotes)
  .catch(() => {});

function appPath(pathname = ''): string {
  const suffix = pathname.replace(/^\/+/, '');
  return `${appBasePath}/${suffix}`;
}

async function loadClientConfiguration(): Promise<RTCConfiguration> {
  const response = await fetch(appPath('config'), { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load the connection configuration.');
  const config = await response.json() as { iceServers?: RTCIceServer[] };
  if (!Array.isArray(config.iceServers)) throw new Error('The connection configuration is invalid.');
  rtcConfig = { iceServers: config.iceServers };
  return rtcConfig;
}

function setScreen(screen: 'landing' | 'room') {
  landing.hidden = screen !== 'landing';
  room.hidden = screen !== 'room';
  document.body.dataset.screen = screen;
}

function showToast(message: string, tone: ToastTone = 'default') {
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function normalizeRoomCode(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
  return normalized.match(/(?:room\/)?([a-z0-9-]{6,32})\/?$/)?.[1] || '';
}

async function captureDisplay() {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing is not supported in this browser.');
  const video = currentStreamSettings.codec === NATIVE_VIDEO_CODEC_ID
    ? {
        width: { ideal: currentStreamSettings.width, max: currentStreamSettings.width },
        height: { ideal: currentStreamSettings.height, max: currentStreamSettings.height },
        frameRate: { ideal: currentStreamSettings.frameRate, max: currentStreamSettings.frameRate },
      }
    : { frameRate: { ideal: currentStreamSettings.frameRate, max: 12 } };
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video,
    audio: shareAudioEnabled,
  });
  const videoTrack = stream.getVideoTracks()[0];
  videoTrack.contentHint = currentStreamSettings.codec === TEXT_CODEC_ID || currentStreamSettings.frameRate < 60 ? 'detail' : 'motion';
  videoTrack.onended = () => stopLocalPresentation();
  if (shareAudioEnabled && stream.getAudioTracks().length === 0) {
    showToast('Audio was not available for the selected screen.', 'error');
  }
  return stream;
}

function createLocalPresentation(stream: MediaStream, settings: RoomStreamSettings): LocalPresentation {
  if (settings.codec === TEXT_CODEC_ID) {
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) videoTrack.contentHint = 'detail';
    const text = createTextPresentation(stream, settings);
    return {
      stream,
      videoTrack: text.videoTrack,
      codec: TEXT_CODEC_ID,
      start: () => text.start(),
      updateSettings: (next) => { if (next.codec === TEXT_CODEC_ID) text.updateSettings(next); },
      connect: (participantId, channel) => text.connect(participantId, channel),
      disconnect: (participantId) => text.disconnect(participantId),
      audioTracks: () => text.audioTracks(),
      setAudioEnabled: (enabled) => text.setAudioEnabled(enabled),
      stop: (stopTracks) => text.stop(stopTracks),
    };
  }
  let stopped = false;
  return {
    stream,
    videoTrack: stream.getVideoTracks()[0],
    codec: NATIVE_VIDEO_CODEC_ID,
    start: async () => applyVideoConstraints(stream.getVideoTracks()[0], settings),
    updateSettings: (next) => {
      if (!stopped && next.codec === NATIVE_VIDEO_CODEC_ID) void applyVideoConstraints(stream.getVideoTracks()[0], next);
    },
    connect: () => {},
    disconnect: () => {},
    audioTracks: () => stream.getAudioTracks().filter((track) => track.readyState === 'live'),
    setAudioEnabled: (enabled) => {
      for (const track of stream.getAudioTracks()) track.enabled = enabled;
    },
    stop: (stopTracks = true) => {
      stopped = true;
      if (stopTracks) stopMediaStream(stream);
    },
  };
}

async function applyVideoConstraints(track: MediaStreamTrack | undefined, settings: NativeVideoSettings) {
  if (!track) return;
  track.contentHint = settings.frameRate >= 60 ? 'motion' : 'detail';
  try {
    await track.applyConstraints({
      width: { ideal: settings.width, max: settings.width },
      height: { ideal: settings.height, max: settings.height },
      frameRate: { ideal: settings.frameRate, max: settings.frameRate },
    });
  } catch {}
}

async function syncNativeVideoTrack() {
  if (!mesh || !localPresentation) return;
  if (currentStreamSettings.codec === NATIVE_VIDEO_CODEC_ID) {
    await mesh.setVideoTrack(localPresentation.videoTrack ?? null, currentStreamSettings.bitrate);
  } else {
    await mesh.setVideoTrack(null);
  }
}

async function startRoom() {
  const button = $('#share-button');
  button.disabled = true;
  button.classList.add('loading');
  try {
    await configReady;
    signaling = await createRoom(appPath('api'), {
      password: optionalInputValue('#room-password'),
    });
    session.startHosting(signaling.roomId, signaling.participantId);
    syncSignalingParticipants(signaling);
    history.replaceState({}, '', appPath(`room/${session.roomId}`));
    prepareRoomShell();

    startNativeMesh(signaling);
    session.markLive();
    setChatEnabled(true);
    announceSystem('Host', 'joined the room.', 'joined');
    updateRoomUI();
  } catch (error: unknown) {
    disposeLocalPresentation();
    disposeConnections();
    session.reset();
    setScreen('landing');
    history.replaceState({}, '', appPath());
    showToast(errorMessage(error, 'Could not start the room.'), 'error');
  } finally {
    button.disabled = false;
    button.classList.remove('loading');
  }
}

async function joinRoom(id: string, password = '') {
  session.startJoining(id);
  prepareRoomShell();
  await configReady;
  try {
    signaling = await joinSignalingRoom(appPath('api'), id, { password });
    session.setLocalPeer(signaling.participantId, signaling.hostId);
    syncSignalingParticipants(signaling);
    startNativeMesh(signaling);
    for (const participant of signaling.participants) mesh?.connect(participant.id);
  } catch (error: unknown) {
    if (error instanceof SignalingError && ['password-required', 'invalid-password'].includes(error.code)) {
      const entered = await requestRoomPassword(id, error.code === 'invalid-password');
      if (entered !== null) return joinRoom(id, entered);
      cancelPendingJoin(id);
      return;
    }
    endViewer(errorMessage(error, 'Could not connect to this room.'));
  }
}

function requestRoomPassword(roomId: string, invalid: boolean) {
  $('#join-password-room').textContent = roomId;
  joinPasswordInput.value = '';
  joinPasswordInput.type = 'password';
  $('#join-password-visibility').setAttribute('aria-pressed', 'false');
  $('#join-password-visibility').setAttribute('aria-label', 'Show password');
  const visibilityLabel = $('#join-password-visibility span');
  visibilityLabel.textContent = 'Show';
  joinPasswordError.textContent = invalid ? 'That password did not work. Try again.' : '';
  joinPasswordError.hidden = !invalid;
  joinPasswordDialog.showModal();
  queueMicrotask(() => joinPasswordInput.focus());
  return new Promise<string | null>((resolve) => { resolvePasswordPrompt = resolve; });
}

function finishPasswordPrompt(password: string | null) {
  const resolve = resolvePasswordPrompt;
  resolvePasswordPrompt = undefined;
  if (joinPasswordDialog.open) joinPasswordDialog.close();
  resolve?.(password);
}

function cancelPendingJoin(roomId: string) {
  disposeConnections();
  session.reset();
  setScreen('landing');
  $('#room-code').value = roomId;
  history.replaceState({}, '', appPath());
}

function prepareRoomShell() {
  toggleConnectivityPanel(false);
  connectivityResults.clear();
  $('#room-code-display').textContent = session.roomId;
  $('#room-title').textContent = `Room ${session.roomId}`;
  $('#leave-room-button span').textContent = session.isHost ? 'Close room' : 'Leave room';
  setScreen('room');
  updateParticipantCount(session.isHost ? 1 : 0);
  updateRoomUI();
}

function startNativeMesh(roomSignaling: RestSignalingSession) {
  mesh = new RtcMesh(roomSignaling.participantId, rtcConfig, (signal) => roomSignaling.send(signal), {
    peerAvailable: routePeer,
    peerClosed: handlePeerClosed,
    mediaTrack: receiveMediaTrack,
    refreshConfiguration: loadClientConfiguration,
    error: (_, error) => showToast(error.message || 'A peer connection failed.', 'error'),
  });
  roomSignaling.onSignal((signal) => mesh?.handleSignal(signal));
  roomSignaling.onUnavailable(() => {
    if (!session.isHost) endViewer('The room is no longer available.');
    else showToast('The room service connection expired.', 'error');
  });
  roomSignaling.start();
}

function routePeer(peerConnection: RtcPeerChannels) {
  peerChannels.set(peerConnection.peerId, peerConnection);
  peerConnection.diagnostics.on('message', (value) => handleConnectivityMessage(peerConnection, value));
  peerConnection.diagnostics.on('close', () => cancelPeerConnectivity(peerConnection.peerId, 'The peer disconnected during the check.'));
  peerConnection.diagnostics.on('error', () => cancelPeerConnectivity(peerConnection.peerId, 'The connection check failed.'));
  if (session.isHost) {
    if (peerConnection.control.open) acceptViewer(peerConnection);
    else peerConnection.control.on('open', () => acceptViewer(peerConnection));
    return;
  }
  if (peerConnection.peerId === session.hostId) {
    viewerControl = peerConnection.control;
    viewerControl.on('message', handleRoomMessage);
    viewerControl.on('close', () => endViewer('The room is no longer available.'));
  }
  if (localPresentation) connectLocalStreamTo(peerConnection.peerId);
  attachIncomingTextStream(peerConnection.peerId);
}

function acceptViewer(peerConnection: RtcPeerChannels) {
  const viewerId = peerConnection.peerId;
  const connection = peerConnection.control;
  if (hostConnections.has(viewerId)) {
    return;
  }
  const identity = uniqueGuestIdentity(viewerId);
  hostConnections.set(viewerId, { control: connection, name: identity.name, lastMessageAt: 0 });
  participantIds.add(viewerId);
  participantNames.set(viewerId, identity.name);
  renderParticipantPresence();
  const viewer = hostConnections.get(viewerId);
  if (!viewer) return;
  connection.send({ type: 'accepted', name: viewer.name, hostId: session.hostId });
  connection.send({ type: 'chat-history', messages: chatHistory });
  connection.send({ type: 'room-state', presenters: [...presenters.values()], participants: roomParticipants() });
  announceSystem(viewer.name, 'joined the room.', 'joined');
  broadcastParticipantCount();
  for (const presenter of presenters.values()) {
    if (presenter.id === session.hostId) connectLocalStreamTo(viewerId);
    else hostConnections.get(presenter.id)?.control.send({ type: 'participant-joined', participant: participantInfo(viewerId, viewer.name) });
  }
  for (const [participantId, participant] of hostConnections) {
    if (participantId !== viewerId && participant.control.open) {
      participant.control.send({ type: 'participant-joined', participant: participantInfo(viewerId, viewer.name) });
    }
  }
  connection.on('message', (value) => handleViewerData(viewerId, value));
  connection.on('close', () => removeViewer(viewerId, connection));
  connection.on('error', () => removeViewer(viewerId, connection));
}

function handleRoomMessage(value: unknown) {
  const message = parseHostRoomMessage(value, session.hostId);
  if (!message) return;
  switch (message.type) {
    case 'room-full':
      endViewer('The service has reached its participant capacity.');
      break;
    case 'room-closed':
      endViewer('The room was closed by its host.');
      break;
    case 'accepted':
      session.markLive({ viewerName: message.name, hostId: message.hostId });
      setChatEnabled(true);
      updateRoomUI();
      break;
    case 'chat-history':
      loadChatHistory(message.messages);
      break;
    case 'chat':
      appendChatEntry(message);
      break;
    case 'chat-activity':
      appendChatEntry(message);
      break;
    case 'participant-count':
      updateParticipantCount(message.participantCount);
      break;
    case 'room-state':
      participantIds.clear();
      participantNames.clear();
      for (const participant of message.participants) rememberParticipant(participant);
      renderParticipantPresence();
      for (const presenter of message.presenters) upsertPresenter(presenter);
      break;
    case 'stream-started':
      upsertPresenter(message.presenter);
      break;
    case 'stream-stopped':
      if (message.presenterId) removePresenter(message.presenterId);
      break;
    case 'stream-settings':
    case 'stream-audio':
      upsertPresenter(message.presenter);
      break;
    case 'share-approved':
      session.finishPresentation();
      connectLocalStreamToParticipants(message.participants);
      updateRoomUI();
      break;
    case 'participant-joined':
      rememberParticipant(message.participant);
      renderParticipantPresence();
      if (localPresentation) connectLocalStreamTo(message.participant.id);
      break;
    case 'participant-left':
      participantIds.delete(message.peerId);
      participantNames.delete(message.peerId);
      renderParticipantPresence();
      disconnectLocalStreamFrom(message.peerId);
      if (presenters.has(message.peerId)) removePresenter(message.peerId);
      mesh?.closePeer(message.peerId);
      break;
  }
}

function handleViewerData(viewerId: string, value: unknown) {
  const message = parseViewerRoomMessage(value);
  if (!message) return;
  const viewer = hostConnections.get(viewerId);
  if (!viewer) return;

  if (message.type === 'stream-started') {
    const settings = message.streamSettings || qualityPresets['720p'];
    const presenter: PresenterInfo = {
      id: viewerId,
      name: viewer.name,
      isHost: false,
      audioEnabled: message.audioEnabled,
      settings,
    };
    upsertPresenter(presenter);
    broadcast({ type: 'stream-started', presenter });
    announceSystem(viewer.name, 'started sharing.', 'stream-started');
    const participants = [signaling?.participantId, ...hostConnections.keys()].filter((id): id is string => Boolean(id && id !== viewerId));
    viewer.control.send({ type: 'share-approved', participants });
    return;
  }
  if (message.type === 'stop-presenting') {
    if (!presenters.has(viewerId)) return;
    removePresenter(viewerId);
    broadcast({ type: 'stream-stopped', presenterId: viewerId });
    announceSystem(viewer.name, 'stopped sharing.', 'stream-stopped');
    return;
  }
  if (message.type === 'settings-changed') {
    const settings = message.streamSettings;
    const presenter = presenters.get(viewerId);
    if (!presenter) return;
    const updated = { ...presenter, settings };
    upsertPresenter(updated);
    broadcast({ type: 'stream-settings', presenter: updated });
    announceSystem(viewer.name, `changed stream settings to ${settings.buttonLabel} (${settings.label}).`, 'settings');
    return;
  }
  if (message.type === 'audio-changed') {
    const presenter = presenters.get(viewerId);
    if (!presenter) return;
    const updated = { ...presenter, audioEnabled: message.audioEnabled };
    upsertPresenter(updated);
    broadcast({ type: 'stream-audio', presenter: updated });
    announceSystem(viewer.name, message.audioEnabled ? 'resumed stream audio.' : 'stopped sending stream audio.', 'audio');
    return;
  }
  if (message.type === 'settings-selected') {
    const settings = message.streamSettings;
    announceSystem(viewer.name, `selected ${settings.buttonLabel} (${settings.label}) for their next stream.`, 'settings');
    return;
  }
  if (message.type !== 'chat') return;
  const text = message.text.trim();
  const now = Date.now();
  if (!text || now - viewer.lastMessageAt < 300) return;
  viewer.lastMessageAt = now;
  const chatMessage = makeChatMessage({ sender: 'viewer', senderId: viewerId, author: viewer.name, text });
  rememberChatEntry(chatMessage);
  appendChatEntry(chatMessage);
  broadcast(chatMessage);
}

async function startRoomPresentation() {
  if (localPresentation || session.ended || !signaling?.participantId || !session.beginPresentation()) return;
  updateRoomUI();
  setShareAudioControlsDisabled(true);
  try {
    const stream = await captureDisplay();
    await beginLocalPresentation(stream);
  } catch (error: unknown) {
    session.finishPresentation();
    disposeLocalPresentation();
    updateRoomUI();
    if (errorName(error) !== 'NotAllowedError') showToast(errorMessage(error, 'Could not share this screen.'), 'error');
  }
}

async function beginLocalPresentation(stream: MediaStream) {
  if (!signaling?.participantId || !mesh) throw new Error('The room connection is not ready.');
  try {
    localPresentation = createLocalPresentation(stream, currentStreamSettings);
  } catch (error) {
    stopMediaStream(stream);
    throw error;
  }
  const presenter = localPresenterInfo();
  upsertPresenter(presenter);
  attachLocalPreview(stream, presenter.id);
  await localPresentation.start();
  await mesh.setAudioTrack(localAudioTracks()[0] ?? null);
  await syncNativeVideoTrack();

  if (session.isHost) {
    session.finishPresentation();
    broadcast({ type: 'stream-started', presenter });
    announceSystem('Host', 'started sharing.', 'stream-started');
    connectLocalStreamToParticipants([...hostConnections.keys()]);
  } else if (viewerControl?.open) {
    viewerControl.send({
      type: 'stream-started',
      streamSettings: currentStreamSettings,
      audioEnabled: presenter.audioEnabled,
    });
  } else {
    throw new Error('The room connection is not ready.');
  }
  updateRoomUI();
}

function localPresenterInfo(): PresenterInfo {
  return {
    id: signaling?.participantId || '',
    name: session.isHost ? 'Host' : session.viewerName || 'You',
    isHost: session.isHost,
    audioEnabled: localAudioTracks().some((track) => track.enabled),
    settings: { ...currentStreamSettings },
  };
}

function connectLocalStreamToParticipants(participantIds: string[]) {
  for (const participantId of participantIds) connectLocalStreamTo(participantId);
  updateBandwidthEstimate();
}

function connectLocalStreamTo(participantId: string) {
  const channel = mesh?.peer(participantId)?.screen;
  if (!channel || !localPresentation) return;
  localPresentation.connect(participantId, channel);
  updateBandwidthEstimate();
}

function disconnectLocalStreamFrom(participantId: string) {
  localPresentation?.disconnect(participantId);
  updateBandwidthEstimate();
}

function attachIncomingTextStream(presenterId: string) {
  const presenter = presenters.get(presenterId);
  if (presenterId === signaling?.participantId || incomingTextReceivers.has(presenterId)
    || presenter?.settings.codec !== TEXT_CODEC_ID) return;
  const connection = peerChannels.get(presenterId)?.screen;
  const canvas = streamCardMedia<HTMLCanvasElement>(presenterId, 'canvas');
  if (!connection || !canvas) return;
  const receiver = new TextStreamReceiver(canvas, connection, () => setCardConnected(presenterId));
  incomingTextReceivers.set(presenterId, receiver);
  connection.on('close', () => {
    if (incomingTextReceivers.get(presenterId) === receiver) incomingTextReceivers.delete(presenterId);
  });
}

function receiveMediaTrack(peerId: string, track: MediaStreamTrack, streams: readonly MediaStream[]) {
  if (track.kind === 'video') {
    const stream = streams[0] ?? new MediaStream([track]);
    remoteVideoStreams.set(peerId, stream);
    attachIncomingNativeStream(peerId);
    track.addEventListener('ended', () => {
      if (remoteVideoStreams.get(peerId) === stream) remoteVideoStreams.delete(peerId);
    }, { once: true });
    return;
  }
  if (track.kind !== 'audio' || peerId === signaling?.participantId) return;
  const audio = remoteAudioElements.get(peerId) || document.createElement('audio');
  audio.autoplay = true;
  audio.srcObject = streams[0] ?? new MediaStream([track]);
  audio.muted = mutedPresenters.has(peerId);
  remoteAudioElements.set(peerId, audio);
  const name = presenters.get(peerId)?.name ?? 'participant';
  void audio.play().catch(() => showToast(`Click ${name}’s mute button to enable audio.`));
  track.addEventListener('ended', () => closeIncomingAudio(peerId), { once: true });
}

function attachIncomingNativeStream(presenterId: string) {
  const presenter = presenters.get(presenterId);
  const stream = remoteVideoStreams.get(presenterId);
  const video = streamCardMedia<HTMLVideoElement>(presenterId, 'video');
  if (!stream || !video || presenter?.settings.codec !== NATIVE_VIDEO_CODEC_ID) return;
  video.srcObject = stream;
  void video.play().then(() => setCardConnected(presenterId)).catch(() => {});
}

function closeIncomingAudio(presenterId: string) {
  const audio = remoteAudioElements.get(presenterId);
  if (audio) audio.srcObject = null;
  remoteAudioElements.delete(presenterId);
}

function stopLocalPresentation() {
  if (!localPresentation) return;
  const presenterId = signaling?.participantId;
  disposeLocalPresentation();
  void mesh?.setAudioTrack(null);
  void mesh?.setVideoTrack(null);
  session.finishPresentation();
  if (presenterId) removePresenter(presenterId);

  if (presenterId) {
    if (session.isHost) {
      broadcast({ type: 'stream-stopped', presenterId });
      announceSystem('Host', 'stopped sharing.', 'stream-stopped');
    } else {
      viewerControl?.send({ type: 'stop-presenting' });
    }
  } else if (!session.isHost) {
    viewerControl?.send({ type: 'stop-presenting' });
  }
  updateBandwidthEstimate();
  updateRoomUI();
}

function disposeLocalPresentation() {
  const presentation = localPresentation;
  localPresentation = undefined;
  presentation?.stop();
  setShareAudioControlsDisabled(false);
}

function stopMediaStream(stream: MediaStream) {
  for (const track of stream.getTracks()) {
    track.onended = null;
    track.stop();
  }
}

function localAudioTracks() {
  return localPresentation?.audioTracks() || [];
}

function toggleLocalAudio() {
  const tracks = localAudioTracks();
  if (!tracks.length) return;
  const enabled = !tracks.some((track) => track.enabled);
  localPresentation?.setAudioEnabled(enabled);
  const presenter = localPresenterInfo();
  upsertPresenter(presenter);
  if (session.isHost) {
    broadcast({ type: 'stream-audio', presenter });
    announceSystem('Host', enabled ? 'resumed stream audio.' : 'stopped sending stream audio.', 'audio');
  } else {
    viewerControl?.send({ type: 'audio-changed', audioEnabled: enabled });
  }
  updateRoomUI();
  updateBandwidthEstimate();
  showToast(enabled ? 'Stream audio resumed.' : 'Stream audio stopped.');
}

function upsertPresenter(presenter: PresenterInfo) {
  const previous = presenters.get(presenter.id);
  if (previous && previous.settings.codec !== presenter.settings.codec) {
    incomingTextReceivers.get(presenter.id)?.close();
    incomingTextReceivers.delete(presenter.id);
    streamGrid.querySelector(`[data-presenter-id="${CSS.escape(presenter.id)}"]`)?.remove();
  }
  presenters.set(presenter.id, presenter);
  renderParticipantPresence();
  renderStreamCard(presenter);
  attachIncomingTextStream(presenter.id);
  attachIncomingNativeStream(presenter.id);
  updateStreamGrid();
}

function removePresenter(presenterId: string) {
  presenters.delete(presenterId);
  renderParticipantPresence();
  incomingTextReceivers.get(presenterId)?.close();
  incomingTextReceivers.delete(presenterId);
  closeIncomingAudio(presenterId);
  remoteVideoStreams.delete(presenterId);
  mutedPresenters.delete(presenterId);
  streamGrid.querySelector(`[data-presenter-id="${CSS.escape(presenterId)}"]`)?.remove();
  updateStreamGrid();
}

function renderStreamCard(presenter: PresenterInfo) {
  let card = streamGrid.querySelector<HTMLElement>(`[data-presenter-id="${CSS.escape(presenter.id)}"]`);
  const isLocal = presenter.id === signaling?.participantId;
  if (!card) {
    card = document.createElement('article');
    card.className = 'stream-card connecting';
    card.dataset.presenterId = presenter.id;
    const media = document.createElement('div');
    media.className = 'stream-card-media';
    const visual = document.createElement(isLocal || presenter.settings.codec === NATIVE_VIDEO_CODEC_ID ? 'video' : 'canvas');
    visual.setAttribute('playsinline', '');
    if (visual instanceof HTMLVideoElement) {
      visual.autoplay = true;
      visual.muted = isLocal;
    }
    const loading = document.createElement('div');
    loading.className = 'stream-connecting';
    loading.innerHTML = '<span></span><b>Connecting stream…</b>';
    const fullscreen = document.createElement('button');
    fullscreen.className = 'stream-fullscreen';
    fullscreen.type = 'button';
    fullscreen.setAttribute('aria-label', 'Enter fullscreen');
    fullscreen.title = 'Enter fullscreen';
    fullscreen.innerHTML = `
      <svg class="fullscreen-enter" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>
      <svg class="fullscreen-exit" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5"/></svg>`;
    fullscreen.addEventListener('click', () => void toggleStreamFullscreen(media));
    media.append(visual, loading, fullscreen);

    const footer = document.createElement('footer');
    footer.innerHTML = `
      <div class="stream-person"><span class="stream-avatar"></span><span><strong></strong><small></small></span></div>
      <div class="stream-card-actions"><span class="audio-state"></span><button class="stream-mute" type="button"><svg viewBox="0 0 24 24"><path d="M11 5 6.5 9H3v6h3.5L11 19V5ZM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/><path class="muted-line" d="m4 4 16 16"/></svg><span></span></button></div>`;
    footer.querySelector<HTMLButtonElement>('.stream-mute')?.addEventListener('click', () => toggleRemoteMute(presenter.id));
    card.append(media, footer);
    streamGrid.append(card);
  }
  card.classList.toggle('local-stream', isLocal);
  card.classList.toggle('host-stream', presenter.isHost);
  const avatar = card.querySelector('.stream-avatar');
  const name = card.querySelector('.stream-person strong');
  const settings = card.querySelector('.stream-person small');
  const audioState = card.querySelector('.audio-state');
  if (avatar) avatar.textContent = initials(presenter.name);
  if (name) name.textContent = `${presenter.name}${presenter.isHost ? ' · Host' : ''}${isLocal ? ' · You' : ''}`;
  if (settings) settings.textContent = `${presenter.settings.buttonLabel} · ${presenter.settings.label}`;
  if (audioState) {
    audioState.textContent = presenter.audioEnabled ? 'Audio on' : 'No audio';
    audioState.classList.toggle('off', !presenter.audioEnabled);
  }
  updateMuteButton(presenter.id);
}

function attachLocalPreview(stream: MediaStream, presenterId: string) {
  const video = streamCardMedia<HTMLVideoElement>(presenterId, 'video');
  if (!video) return;
  video.srcObject = stream;
  void video.play().then(() => setCardConnected(presenterId)).catch(() => {});
}

function streamCardMedia<ElementType extends HTMLVideoElement | HTMLCanvasElement>(presenterId: string, tag: 'video' | 'canvas') {
  return streamGrid.querySelector<ElementType>(`[data-presenter-id="${CSS.escape(presenterId)}"] ${tag}`);
}

async function toggleStreamFullscreen(media: HTMLElement) {
  try {
    if (document.fullscreenElement === media) await document.exitFullscreen();
    else await media.requestFullscreen();
  } catch {
    showToast('Fullscreen is not available in this browser.');
  }
}

function updateFullscreenButtons() {
  for (const button of streamGrid.querySelectorAll<HTMLButtonElement>('.stream-fullscreen')) {
    const active = document.fullscreenElement === button.parentElement;
    const label = active ? 'Exit fullscreen' : 'Enter fullscreen';
    button.classList.toggle('active', active);
    button.setAttribute('aria-label', label);
    button.title = label;
  }
}

function setCardConnected(presenterId: string) {
  streamGrid.querySelector(`[data-presenter-id="${CSS.escape(presenterId)}"]`)?.classList.remove('connecting');
}

function toggleRemoteMute(presenterId: string) {
  if (presenterId === signaling?.participantId) return;
  if (mutedPresenters.has(presenterId)) mutedPresenters.delete(presenterId);
  else mutedPresenters.add(presenterId);
  const audio = remoteAudioElements.get(presenterId);
  if (audio) {
    audio.muted = mutedPresenters.has(presenterId);
    if (!audio.muted) void audio.play().catch(() => {});
  }
  updateMuteButton(presenterId);
}

function updateMuteButton(presenterId: string) {
  const button = streamGrid.querySelector<HTMLButtonElement>(`[data-presenter-id="${CSS.escape(presenterId)}"] .stream-mute`);
  if (!button) return;
  const isLocal = presenterId === signaling?.participantId;
  const muted = isLocal || mutedPresenters.has(presenterId);
  button.classList.toggle('muted', muted);
  button.disabled = isLocal;
  button.setAttribute('aria-pressed', String(muted));
  button.setAttribute('aria-label', isLocal ? 'Your preview is muted' : muted ? 'Unmute this stream' : 'Mute this stream');
  const label = button.querySelector('span');
  if (label) label.textContent = isLocal ? 'Preview muted' : muted ? 'Unmute' : 'Mute';
}

function updateStreamGrid() {
  const count = presenters.size;
  streamsEmpty.hidden = count > 0;
  streamGrid.hidden = count === 0;
  streamGrid.dataset.count = String(count);
  $('#stream-count').textContent = count ? `${count} active ${count === 1 ? 'stream' : 'streams'}` : 'No active streams';
  updateRoomUI();
}

function updateRoomUI() {
  const sharing = Boolean(localPresentation);
  const streamButton = $('#stream-button');
  streamButton.disabled = session.ended || session.presentationPending || (!session.isHost && !viewerControl?.open);
  streamButton.classList.toggle('stop-stream', sharing);
  const streamButtonLabel = streamButton.querySelector('span');
  if (streamButtonLabel) streamButtonLabel.textContent = sharing ? 'Stop sharing' : session.presentationPending ? 'Opening picker…' : 'Start sharing';
  $('#your-stream-status').textContent = sharing
    ? `${currentStreamSettings.buttonLabel} · ${localAudioTracks().some((track) => track.enabled) ? 'audio on' : 'audio off'}`
    : session.presentationPending ? 'Starting…' : 'Not sharing';
  $('#share-audio-option').hidden = sharing;
  const audioButton = $('#local-audio-button');
  const hasAudio = localAudioTracks().length > 0;
  const audioEnabled = localAudioTracks().some((track) => track.enabled);
  audioButton.hidden = !sharing || !hasAudio;
  audioButton.classList.toggle('muted', hasAudio && !audioEnabled);
  const label = audioButton.querySelector('span');
  if (label) label.textContent = audioEnabled ? 'Stop audio' : 'Resume audio';
}

function updateParticipantCount(count: number) {
  if (!session.setParticipantCount(count)) return;
  const label = `${session.participantCount} ${session.participantCount === 1 ? 'participant' : 'participants'}`;
  document.querySelectorAll('[data-participant-count]').forEach((element) => { element.textContent = label; });
  updateBandwidthEstimate();
}

function syncSignalingParticipants(roomSignaling: RestSignalingSession) {
  participantIds.clear();
  participantNames.clear();
  participantIds.add(roomSignaling.hostId);
  participantNames.set(roomSignaling.hostId, 'Host');
  participantIds.add(roomSignaling.participantId);
  participantNames.set(roomSignaling.participantId, roomSignaling.participant.name);
  for (const participant of roomSignaling.participants) {
    participantIds.add(participant.id);
    participantNames.set(participant.id, participant.name);
  }
  renderParticipantPresence();
}

function uniqueGuestIdentity(participantId: string) {
  const usedNames = new Set([...hostConnections.values()].map((viewer) => viewer.name));
  for (let attempt = 0; attempt < guestIdentityCount; attempt += 1) {
    const identity = guestIdentity(participantId, attempt);
    if (!usedNames.has(identity.name)) return identity;
  }
  throw new Error('No anonymous guest identities are available.');
}

function participantInfo(id: string, name: string): ParticipantInfo {
  return { id, name, isHost: id === session.hostId };
}

function roomParticipants(): ParticipantInfo[] {
  return [participantInfo(session.hostId, 'Host'), ...[...hostConnections].map(([id, viewer]) => participantInfo(id, viewer.name))];
}

function rememberParticipant(participant: ParticipantInfo) {
  participantIds.add(participant.id);
  participantNames.set(participant.id, participant.name);
}

function renderParticipantPresence() {
  const container = document.querySelector<HTMLElement>('#participant-avatars');
  if (!container) return;
  container.replaceChildren();
  const localId = signaling?.participantId;
  const visible = [...participantIds].slice(0, 5);
  for (const participantId of visible) {
    const isHost = participantId === (signaling?.hostId || session.hostId);
    const isLocal = participantId === localId;
    const isSharing = presenters.has(participantId);
    const assignedName = participantNames.get(participantId);
    const identity = isHost
      ? { name: 'Host', emoji: '👑', color: 0 }
      : assignedName ? guestIdentityWithName(participantId, assignedName) : guestIdentity(participantId);
    const name = assignedName || identity.name;
    const label = `${name}${isHost ? ' · Host' : ''}${isLocal ? ' · You' : ''}${isSharing ? ' · Sharing' : ''}`;
    const avatar = document.createElement('span');
    avatar.className = `participant-avatar color-${identity.color}${isHost ? ' host' : ''}${isSharing ? ' sharing' : ''}`;
    avatar.textContent = identity.emoji;
    avatar.tabIndex = 0;
    avatar.dataset.tooltip = label;
    avatar.setAttribute('aria-label', label);
    container.append(avatar);
  }
  const hidden = participantIds.size - visible.length;
  if (hidden > 0) {
    const overflow = document.createElement('span');
    overflow.className = 'participant-avatar participant-overflow';
    overflow.textContent = `+${hidden}`;
    overflow.tabIndex = 0;
    overflow.dataset.tooltip = `${hidden} more ${hidden === 1 ? 'participant' : 'participants'}`;
    overflow.setAttribute('aria-label', overflow.dataset.tooltip);
    container.append(overflow);
  }
  if (!$('#connection-check-panel').hidden) renderConnectivityResults();
}

function toggleConnectivityPanel(force?: boolean) {
  const panel = $<HTMLElement>('#connection-check-panel');
  const shouldOpen = force ?? panel.hidden;
  panel.hidden = !shouldOpen;
  $('#connection-check-button').setAttribute('aria-expanded', String(shouldOpen));
  if (shouldOpen) {
    renderConnectivityResults();
    void runConnectivityChecks();
  } else {
    connectivityRun += 1;
    connectivityTesting = false;
    cancelConnectivityRequests('Connection check stopped.');
  }
}

async function runConnectivityChecks() {
  const panel = $<HTMLElement>('#connection-check-panel');
  if (panel.hidden) return;
  const run = ++connectivityRun;
  connectivityTesting = true;
  cancelConnectivityRequests('A new connection check started.');
  const localId = signaling?.participantId;
  const peerIds = [...participantIds].filter((id) => id !== localId);
  connectivityResults.clear();
  for (const peerId of peerIds) connectivityResults.set(peerId, { status: 'testing' });
  setConnectivitySummary(peerIds.length ? 'testing' : 'idle', peerIds.length ? 'Checking every peer…' : 'No peers to check', peerIds.length
    ? 'Measuring ping, transfer speed, packet loss, and connection route.'
    : 'Invite someone to the room, then run the check again.');
  syncConnectivityRunButton();
  renderConnectivityResults();
  if (!peerIds.length) {
    connectivityTesting = false;
    syncConnectivityRunButton();
    return;
  }

  let cursor = 0;
  const worker = async () => {
    while (cursor < peerIds.length && run === connectivityRun && !panel.hidden) {
      const peerId = peerIds[cursor++];
      try {
        connectivityResults.set(peerId, await testPeerConnectivity(peerId));
      } catch (error) {
        connectivityResults.set(peerId, {
          status: 'error',
          quality: 'poor',
          error: errorMessage(error, 'This peer did not respond to the check.'),
        });
      }
      if (run === connectivityRun && !panel.hidden) renderConnectivityResults();
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, peerIds.length) }, worker));
  if (run !== connectivityRun || panel.hidden) return;
  connectivityTesting = false;
  syncConnectivityRunButton();
  updateConnectivitySummary();
}

async function testPeerConnectivity(peerId: string): Promise<ConnectivityResult> {
  const channel = peerChannels.get(peerId)?.diagnostics;
  if (!channel) throw new Error('Waiting for a direct peer connection.');
  await waitForConnectivityChannel(channel);
  const pingSamples: number[] = [];
  for (let sample = 0; sample < 3; sample += 1) pingSamples.push(await measureConnectivityPing(channel));
  const downloadBps = await measureConnectivityDownload(channel);
  const uploadBps = await measureConnectivityUpload(channel);
  const stats = await mesh?.connectionStats(peerId).catch(() => undefined);
  const pingMs = median(pingSamples);
  const quality = connectionQuality(pingMs, downloadBps, uploadBps, stats?.packetLossPercent);
  return {
    status: 'complete',
    quality,
    pingMs,
    downloadBps,
    uploadBps,
    packetLossPercent: stats?.packetLossPercent,
    route: stats?.route ?? 'unknown',
  };
}

function handleConnectivityMessage(peer: RtcPeerChannels, value: unknown) {
  const message = connectivityMessage(value);
  if (!message) return;
  const { diagnostics: channel, peerId } = peer;
  const key = message.id;
  if (message.type === 'connectivity-ping') {
    if (channel.open) channel.send({ type: 'connectivity-pong', id: key });
    return;
  }
  if (message.type === 'connectivity-pong') {
    const pending = pendingConnectivityPings.get(key);
    if (!pending || pending.peerId !== peerId) return;
    clearTimeout(pending.timer);
    pendingConnectivityPings.delete(key);
    pending.resolve(performance.now() - pending.startedAt);
    return;
  }
  if (message.type === 'connectivity-download-request') {
    const now = performance.now();
    const lastResponse = connectivityDownloadResponseAt.get(peerId);
    if (lastResponse !== undefined && now - lastResponse < 750) return;
    connectivityDownloadResponseAt.set(peerId, now);
    void sendConnectivityBurst(channel, key, 'download').catch(() => {});
    return;
  }
  if (message.type === 'connectivity-download-start') {
    const pending = pendingConnectivityDownloads.get(key);
    if (!pending || pending.peerId !== peerId) return;
    pending.startedAt = undefined;
    pending.bytes = 0;
    pending.chunks = 0;
    return;
  }
  if (message.type === 'connectivity-download-chunk') {
    const pending = pendingConnectivityDownloads.get(key);
    if (!pending || pending.peerId !== peerId) return;
    if (!validConnectivityChunk(message, pending.chunks)) {
      failConnectivityTransfer(pendingConnectivityDownloads, key, 'The download probe was malformed.');
      return;
    }
    pending.startedAt ??= performance.now();
    pending.bytes += message.payload.byteLength;
    pending.chunks += 1;
    return;
  }
  if (message.type === 'connectivity-download-complete') {
    finishConnectivityTransfer(pendingConnectivityDownloads, key, peerId);
    return;
  }
  if (message.type === 'connectivity-upload-start') {
    for (const [incomingKey, incoming] of incomingConnectivityUploads) {
      if (incoming.peerId !== peerId) continue;
      clearTimeout(incoming.timer);
      incomingConnectivityUploads.delete(incomingKey);
    }
    const incoming: IncomingConnectivityTransfer = {
      peerId,
      bytes: 0,
      chunks: 0,
      timer: setTimeout(() => incomingConnectivityUploads.delete(key), 8_000),
    };
    incomingConnectivityUploads.set(key, incoming);
    return;
  }
  if (message.type === 'connectivity-upload-chunk') {
    const incoming = incomingConnectivityUploads.get(key);
    if (!incoming || incoming.peerId !== peerId) return;
    if (!validConnectivityChunk(message, incoming.chunks)) {
      clearTimeout(incoming.timer);
      incomingConnectivityUploads.delete(key);
      return;
    }
    incoming.startedAt ??= performance.now();
    incoming.bytes += message.payload.byteLength;
    incoming.chunks += 1;
    return;
  }
  if (message.type === 'connectivity-upload-complete') {
    const incoming = incomingConnectivityUploads.get(key);
    if (!incoming || incoming.peerId !== peerId || !incoming.startedAt
      || incoming.bytes !== CONNECTIVITY_PROBE_BYTES || incoming.chunks !== CONNECTIVITY_CHUNKS) return;
    clearTimeout(incoming.timer);
    incomingConnectivityUploads.delete(key);
    if (channel.open) channel.send({
      type: 'connectivity-upload-result',
      id: key,
      bytes: incoming.bytes,
      durationMs: Math.max(1, performance.now() - incoming.startedAt),
    });
    return;
  }
  if (message.type === 'connectivity-upload-result') {
    const pending = pendingConnectivityUploads.get(key);
    if (!pending || pending.peerId !== peerId || message.bytes !== CONNECTIVITY_PROBE_BYTES
      || typeof message.durationMs !== 'number' || !Number.isFinite(message.durationMs)
      || message.durationMs <= 0 || message.durationMs > 30_000) return;
    clearTimeout(pending.timer);
    pendingConnectivityUploads.delete(key);
    pending.resolve((message.bytes * 8) / (message.durationMs / 1_000));
  }
}

function connectivityMessage(value: unknown): (Record<string, unknown> & { type: string; id: string }) | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const message = value as Record<string, unknown>;
  if (typeof message.type !== 'string' || !message.type.startsWith('connectivity-')
    || typeof message.id !== 'string' || !/^[a-z0-9-]{8,80}$/i.test(message.id)) return undefined;
  return message as Record<string, unknown> & { type: string; id: string };
}

function validConnectivityChunk(
  message: Record<string, unknown>,
  expectedSequence: number,
): message is Record<string, unknown> & { payload: Uint8Array } {
  return message.sequence === expectedSequence
    && message.total === CONNECTIVITY_CHUNKS
    && message.payload instanceof Uint8Array
    && message.payload.byteLength === CONNECTIVITY_CHUNK_BYTES;
}

function measureConnectivityPing(channel: RtcChannel) {
  return new Promise<number>((resolve, reject) => {
    const id = connectivityProbeId();
    const pending: PendingConnectivityPing = {
      peerId: channel.peerId,
      startedAt: performance.now(),
      resolve,
      reject,
      timer: setTimeout(() => {
        pendingConnectivityPings.delete(id);
        reject(new Error('Ping timed out.'));
      }, 2_500),
    };
    pendingConnectivityPings.set(id, pending);
    try { channel.send({ type: 'connectivity-ping', id }); }
    catch (error) {
      clearTimeout(pending.timer);
      pendingConnectivityPings.delete(id);
      reject(error instanceof Error ? error : new Error('Could not send the ping.'));
    }
  });
}

function measureConnectivityDownload(channel: RtcChannel) {
  return new Promise<number>((resolve, reject) => {
    const id = connectivityProbeId();
    const pending = connectivityTransfer(channel.peerId, resolve, reject, () => pendingConnectivityDownloads.delete(id));
    pendingConnectivityDownloads.set(id, pending);
    try { channel.send({ type: 'connectivity-download-request', id }); }
    catch (error) {
      clearTimeout(pending.timer);
      pendingConnectivityDownloads.delete(id);
      reject(error instanceof Error ? error : new Error('Could not start the download check.'));
    }
  });
}

function measureConnectivityUpload(channel: RtcChannel) {
  return new Promise<number>((resolve, reject) => {
    const id = connectivityProbeId();
    const pending = connectivityTransfer(channel.peerId, resolve, reject, () => pendingConnectivityUploads.delete(id));
    pendingConnectivityUploads.set(id, pending);
    void sendConnectivityBurst(channel, id, 'upload').catch((error) => {
      if (!pendingConnectivityUploads.delete(id)) return;
      clearTimeout(pending.timer);
      reject(error instanceof Error ? error : new Error('Could not finish the upload check.'));
    });
  });
}

function connectivityTransfer(peerId: string, resolve: (bitsPerSecond: number) => void, reject: (error: Error) => void, expire: () => void): PendingConnectivityTransfer {
  return {
    peerId,
    bytes: 0,
    chunks: 0,
    resolve,
    reject,
    timer: setTimeout(() => {
      expire();
      reject(new Error('Speed check timed out.'));
    }, 8_000),
  };
}

async function sendConnectivityBurst(channel: RtcChannel, id: string, direction: 'download' | 'upload') {
  if (!channel.open) throw new Error('The peer connection is not ready.');
  channel.send({ type: `connectivity-${direction}-start`, id });
  for (let sequence = 0; sequence < CONNECTIVITY_CHUNKS; sequence += 1) {
    await waitForConnectivityBuffer(channel);
    channel.send({
      type: `connectivity-${direction}-chunk`,
      id,
      sequence,
      total: CONNECTIVITY_CHUNKS,
      payload: connectivityProbeChunk,
    });
    if (sequence % 4 === 3) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  channel.send({ type: `connectivity-${direction}-complete`, id });
}

async function waitForConnectivityBuffer(channel: RtcChannel) {
  const deadline = performance.now() + 5_000;
  while (channel.bufferedAmount > CONNECTIVITY_BUFFER_LIMIT) {
    if (!channel.open) throw new Error('The peer disconnected during the speed check.');
    if (performance.now() >= deadline) throw new Error('The connection is too congested to finish the speed check.');
    await new Promise<void>((resolve) => setTimeout(resolve, 12));
  }
}

function waitForConnectivityChannel(channel: RtcChannel) {
  if (channel.open) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      channel.off('open', opened);
      channel.off('close', closed);
      if (error) reject(error);
      else resolve();
    };
    const opened = () => finish();
    const closed = () => finish(new Error('The peer disconnected before the check started.'));
    const timer = setTimeout(() => finish(new Error('Waiting for the peer connection timed out.')), 4_000);
    channel.on('open', opened);
    channel.on('close', closed);
  });
}

function finishConnectivityTransfer(pendingTransfers: Map<string, PendingConnectivityTransfer>, id: string, peerId: string) {
  const pending = pendingTransfers.get(id);
  if (!pending || pending.peerId !== peerId || !pending.startedAt
    || pending.bytes !== CONNECTIVITY_PROBE_BYTES || pending.chunks !== CONNECTIVITY_CHUNKS) {
    if (pending) failConnectivityTransfer(pendingTransfers, id, 'The speed check returned incomplete data.');
    return;
  }
  clearTimeout(pending.timer);
  pendingTransfers.delete(id);
  const durationMs = Math.max(1, performance.now() - pending.startedAt);
  pending.resolve((pending.bytes * 8) / (durationMs / 1_000));
}

function failConnectivityTransfer(pendingTransfers: Map<string, PendingConnectivityTransfer>, id: string, message: string) {
  const pending = pendingTransfers.get(id);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingTransfers.delete(id);
  pending.reject(new Error(message));
}

function cancelPeerConnectivity(peerId: string, message: string) {
  for (const [id, pending] of pendingConnectivityPings) {
    if (pending.peerId !== peerId) continue;
    clearTimeout(pending.timer);
    pendingConnectivityPings.delete(id);
    pending.reject(new Error(message));
  }
  for (const transfers of [pendingConnectivityDownloads, pendingConnectivityUploads]) {
    for (const [id, pending] of transfers) {
      if (pending.peerId !== peerId) continue;
      clearTimeout(pending.timer);
      transfers.delete(id);
      pending.reject(new Error(message));
    }
  }
  for (const [id, incoming] of incomingConnectivityUploads) {
    if (incoming.peerId !== peerId) continue;
    clearTimeout(incoming.timer);
    incomingConnectivityUploads.delete(id);
  }
}

function cancelConnectivityRequests(message: string) {
  const peerIds = new Set([
    ...[...pendingConnectivityPings.values()].map(({ peerId }) => peerId),
    ...[...pendingConnectivityDownloads.values()].map(({ peerId }) => peerId),
    ...[...pendingConnectivityUploads.values()].map(({ peerId }) => peerId),
    ...[...incomingConnectivityUploads.values()].map(({ peerId }) => peerId),
  ]);
  for (const peerId of peerIds) cancelPeerConnectivity(peerId, message);
}

function connectivityProbeId() {
  return `probe-${crypto.randomUUID()}`;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function connectionQuality(pingMs: number, downloadBps: number, uploadBps: number, packetLossPercent?: number): ConnectivityQuality {
  const loss = packetLossPercent ?? 0;
  if (pingMs < 120 && downloadBps >= 5_000_000 && uploadBps >= 3_000_000 && loss < 2) return 'good';
  if (pingMs < 250 && downloadBps >= 1_000_000 && uploadBps >= 1_000_000 && loss < 5) return 'fair';
  return 'poor';
}

function renderConnectivityResults() {
  const container = $('#connection-check-results');
  const localId = signaling?.participantId;
  const peerIds = [...participantIds].filter((id) => id !== localId);
  container.replaceChildren();
  if (!peerIds.length) {
    const empty = document.createElement('p');
    empty.className = 'connection-check-empty';
    empty.textContent = 'You’re the only person here. Connection results will appear after someone joins.';
    container.append(empty);
    return;
  }
  for (const peerId of peerIds) container.append(connectivityResultCard(peerId, connectivityResults.get(peerId)));
}

function connectivityResultCard(peerId: string, result?: ConnectivityResult) {
  const isHost = peerId === (signaling?.hostId || session.hostId);
  const assignedName = participantNames.get(peerId);
  const identity = isHost
    ? { name: 'Host', emoji: '👑' }
    : assignedName ? guestIdentityWithName(peerId, assignedName) : guestIdentity(peerId);
  const article = document.createElement('article');
  const status = result?.status ?? (connectivityTesting ? 'testing' : 'idle');
  article.className = 'connection-peer';
  article.dataset.quality = status === 'complete' ? result?.quality ?? 'poor' : status;
  article.innerHTML = `
    <div class="connection-peer-heading">
      <div class="connection-peer-person"><span class="connection-peer-avatar"></span><span><strong></strong><small></small></span></div>
      <span class="connection-peer-quality"></span>
    </div>`;
  const avatar = article.querySelector<HTMLElement>('.connection-peer-avatar');
  const name = article.querySelector<HTMLElement>('.connection-peer-person strong');
  const detail = article.querySelector<HTMLElement>('.connection-peer-person small');
  const quality = article.querySelector<HTMLElement>('.connection-peer-quality');
  if (avatar) avatar.textContent = identity.emoji;
  if (name) name.textContent = assignedName || identity.name;
  if (detail) detail.textContent = isHost ? 'Room host' : 'Peer connection';
  if (quality) quality.textContent = status === 'testing' ? 'Checking' : status === 'error' ? 'Unavailable' : status === 'idle' ? 'Not tested' : result?.quality ?? 'Unknown';
  if (status === 'error') {
    const error = document.createElement('p');
    error.className = 'connection-peer-error';
    error.textContent = result?.error ?? 'This peer did not respond to the check.';
    article.append(error);
    return article;
  }
  const metrics = document.createElement('div');
  metrics.className = 'connection-peer-metrics';
  const values = status === 'complete' ? [
    `${Math.round(result?.pingMs ?? 0)} ms`,
    formatConnectivitySpeed(result?.downloadBps),
    formatConnectivitySpeed(result?.uploadBps),
    result?.packetLossPercent === undefined ? '—' : `${result.packetLossPercent.toFixed(result.packetLossPercent < 1 ? 1 : 0)}%`,
  ] : status === 'testing' ? ['Checking', 'Checking', 'Checking', 'Checking'] : ['—', '—', '—', '—'];
  ['Ping', 'Down', 'Up', 'Loss'].forEach((label, index) => {
    const metric = document.createElement('span');
    metric.className = 'connection-metric';
    const metricLabel = document.createElement('small');
    const metricValue = document.createElement('strong');
    metricLabel.textContent = label;
    metricValue.textContent = values[index];
    metric.append(metricLabel, metricValue);
    metrics.append(metric);
  });
  article.append(metrics);
  if (detail && status === 'complete') detail.textContent = result?.route === 'relay' ? 'Relayed connection' : result?.route === 'direct' ? 'Direct connection' : 'Connection route unavailable';
  return article;
}

function updateConnectivitySummary() {
  const results = [...connectivityResults.values()];
  const complete = results.filter((result) => result.status === 'complete');
  const hasErrors = results.some((result) => result.status === 'error');
  const qualities = complete.map((result) => result.quality);
  const quality: ConnectivityQuality = hasErrors || qualities.includes('poor')
    ? 'poor'
    : qualities.includes('fair') ? 'fair' : 'good';
  const title = quality === 'good' ? 'Connections look great' : quality === 'fair' ? 'Connections look usable' : 'Some connections need attention';
  const detail = hasErrors
    ? 'At least one peer did not finish the check. They may still be connecting.'
    : quality === 'good' ? 'Low latency and enough peer-to-peer bandwidth for sharing.'
      : quality === 'fair' ? 'Sharing should work, but quality may adapt during busy moments.'
        : 'High latency, packet loss, or limited bandwidth may affect sharing.';
  setConnectivitySummary(quality, title, detail);
}

function setConnectivitySummary(quality: ConnectivityQuality | 'idle' | 'testing', title: string, detail: string) {
  const summary = $('#connection-check-summary');
  summary.dataset.quality = quality;
  const titleElement = summary.querySelector('strong');
  const detailElement = summary.querySelector('small');
  if (titleElement) titleElement.textContent = title;
  if (detailElement) detailElement.textContent = detail;
}

function syncConnectivityRunButton() {
  const button = $<HTMLButtonElement>('#connection-check-run');
  button.disabled = connectivityTesting;
  button.textContent = connectivityTesting ? 'Checking…' : 'Run again';
}

function formatConnectivitySpeed(bitsPerSecond?: number) {
  if (!bitsPerSecond || !Number.isFinite(bitsPerSecond)) return '—';
  const megabits = bitsPerSecond / 1_000_000;
  return `${megabits >= 10 ? Math.round(megabits) : megabits.toFixed(1)} Mbps`;
}

function broadcastParticipantCount() {
  updateParticipantCount(hostConnections.size + 1);
  broadcast({ type: 'participant-count', participantCount: hostConnections.size + 1 });
}

function removeViewer(viewerId: string, expectedConnection?: RtcChannel) {
  const viewer = hostConnections.get(viewerId);
  if (!viewer || (expectedConnection && viewer.control !== expectedConnection)) return;
  hostConnections.delete(viewerId);
  participantIds.delete(viewerId);
  participantNames.delete(viewerId);
  connectivityResults.delete(viewerId);
  cancelPeerConnectivity(viewerId, 'The peer left the room.');
  renderParticipantPresence();
  peerChannels.delete(viewerId);
  viewer.control.close();
  if (mesh?.peer(viewerId)) mesh.closePeer(viewerId);
  disconnectLocalStreamFrom(viewerId);
  if (presenters.has(viewerId)) {
    removePresenter(viewerId);
    broadcast({ type: 'stream-stopped', presenterId: viewerId });
    announceSystem(viewer.name, 'stopped sharing.', 'stream-stopped');
  }
  for (const { control } of hostConnections.values()) control.send({ type: 'participant-left', peerId: viewerId });
  announceSystem(viewer.name, 'left the room.', 'left');
  broadcastParticipantCount();
}

function handlePeerClosed(peerId: string) {
  peerChannels.delete(peerId);
  connectivityResults.delete(peerId);
  cancelPeerConnectivity(peerId, 'The peer disconnected during the check.');
  incomingTextReceivers.get(peerId)?.close();
  incomingTextReceivers.delete(peerId);
  remoteVideoStreams.delete(peerId);
  closeIncomingAudio(peerId);
  if (session.isHost) removeViewer(peerId);
  else if (peerId === session.hostId) endViewer('The room is no longer available.');
  else {
    disconnectLocalStreamFrom(peerId);
    if (presenters.has(peerId)) removePresenter(peerId);
  }
}

async function setQuality(name: QualityName, customSettings?: NativeVideoSettings) {
  const settings = name === 'custom' ? customSettings : qualityPresets[name];
  if (!settings) return;
  const previousCodec = currentStreamSettings.codec;
  currentStreamSettings = { ...settings };
  if (localPresentation && previousCodec !== settings.codec) {
    const stream = localPresentation.stream;
    localPresentation.stop(false);
    localPresentation = createLocalPresentation(stream, currentStreamSettings);
    await localPresentation.start();
    connectLocalStreamToParticipants(session.isHost ? [...hostConnections.keys()] : [...peerChannels.keys()]);
  } else {
    localPresentation?.updateSettings(currentStreamSettings);
  }
  await syncNativeVideoTrack();
  $('#quality-label').textContent = settings.buttonLabel;
  document.querySelectorAll<HTMLElement>('[data-quality]').forEach((button) => {
    button.classList.toggle('active', button.dataset.quality === name);
  });
  $('#custom-quality-panel').hidden = name !== 'custom';
  document.querySelector('[data-quality="custom"]')?.setAttribute('aria-expanded', String(name === 'custom'));
  updateBandwidthEstimate();
  positionQualityMenu();
  if (localPresentation) {
    const presenter = localPresenterInfo();
    upsertPresenter(presenter);
    if (session.isHost) {
      broadcast({ type: 'stream-settings', presenter });
      announceSystem('Host', `changed stream settings to ${settings.buttonLabel} (${settings.label}).`, 'settings');
    } else {
      viewerControl?.send({ type: 'settings-changed', streamSettings: settings });
    }
  } else if (!room.hidden) {
    if (session.isHost) {
      announceSystem('Host', `selected ${settings.buttonLabel} (${settings.label}) for their next stream.`, 'settings');
    } else {
      viewerControl?.send({ type: 'settings-selected', streamSettings: settings });
    }
  }
  showToast(`${settings.buttonLabel}: ${settings.label}.`);
}

function openCustomQuality() {
  document.querySelectorAll<HTMLElement>('[data-quality]').forEach((button) => {
    button.classList.toggle('active', button.dataset.quality === 'custom');
  });
  $('#custom-quality-panel').hidden = false;
  document.querySelector('[data-quality="custom"]')?.setAttribute('aria-expanded', 'true');
  positionQualityMenu();
}

function customVideoSettings(): NativeVideoSettings {
  const [width, height] = ($('#custom-resolution').value || '1920x1080').split('x').map(Number);
  const frameRate = Number($('#custom-frame-rate').value) || 30;
  const compression = $('#custom-compression').value as NativeVideoSettings['compression'];
  const pixelsPerSecond = width * height * frameRate;
  const bitsPerPixel = compression === 'high' ? 0.045 : compression === 'low' ? 0.1 : 0.07;
  const bitrate = Math.max(500_000, Math.round(pixelsPerSecond * bitsPerPixel / 100_000) * 100_000);
  const resolutionLabel = height === 2160 ? '4K' : `${height}p`;
  return {
    codec: NATIVE_VIDEO_CODEC_ID,
    width,
    height,
    frameRate,
    bitrate,
    compression,
    label: `${resolutionLabel} · ${frameRate} fps · ${compression} compression`,
    buttonLabel: 'Custom',
  };
}

function updateBandwidthEstimate() {
  const audience = Math.max(1, session.participantCount - 1);
  const perPeer = currentStreamSettings.codec === NATIVE_VIDEO_CODEC_ID
    ? currentStreamSettings.bitrate / 1_000_000
    : currentStreamSettings.frameRate * 0.35;
  const estimated = perPeer * audience;
  $('#bandwidth-total').textContent = `≈${formatMbps(estimated)} Mbps`;
  $('#bandwidth-detail').textContent = `${currentStreamSettings.codec === TEXT_CODEC_ID ? 'Content-dependent lossless deltas' : `Up to ${formatMbps(perPeer)} Mbps`} × ${audience} ${audience === 1 ? 'peer' : 'peers'}`;
  $('#bandwidth-capacity').textContent = currentStreamSettings.codec === TEXT_CODEC_ID
    ? 'Text mode prioritizes pixel-perfect detail over motion.'
    : 'Native WebRTC adapts below this limit when the connection needs it.';
}

function formatMbps(value: number) {
  return value.toFixed(1).replace(/\.0$/, '');
}

function closeQualityMenu() {
  qualityMenu.hidden = true;
  qualityMenuAnchor = null;
  document.querySelectorAll('[data-quality-trigger]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
}

function toggleQualityMenu(button: HTMLElement) {
  const reopen = qualityMenu.hidden || qualityMenuAnchor !== button;
  closeQualityMenu();
  if (!reopen) return;
  qualityMenuAnchor = button;
  qualityMenu.hidden = false;
  positionQualityMenu();
  button.setAttribute('aria-expanded', 'true');
}

function positionQualityMenu() {
  if (!qualityMenuAnchor || qualityMenu.hidden) return;
  const margin = 12;
  const gap = 9;
  const anchor = qualityMenuAnchor.getBoundingClientRect();
  const spaceAbove = anchor.top - gap - margin;
  const spaceBelow = window.innerHeight - anchor.bottom - gap - margin;
  const above = spaceAbove >= spaceBelow;
  qualityMenu.style.maxHeight = `${Math.max(220, Math.min(690, above ? spaceAbove : spaceBelow))}px`;
  const width = qualityMenu.offsetWidth;
  const height = qualityMenu.offsetHeight;
  const left = Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin));
  const top = above
    ? Math.max(margin, anchor.top - gap - height)
    : Math.min(anchor.bottom + gap, Math.max(margin, window.innerHeight - height - margin));
  qualityMenu.style.left = `${Math.round(left)}px`;
  qualityMenu.style.top = `${Math.round(top)}px`;
}

function makeChatMessage({ sender, senderId = '', author, text }: {
  sender: 'host' | 'viewer';
  senderId?: string;
  author: string;
  text: string;
}): ChatMessage {
  return { type: 'chat', id: makeId(), sender, senderId, author, text, sentAt: Date.now() };
}

function makeActivity(author: string, text: string, activity: ActivityKind): ChatActivity {
  return { type: 'chat-activity', id: makeId(), activity, author, text, occurredAt: Date.now() };
}

function announceSystem(author: string, text: string, activity: ActivityKind) {
  if (!session.isHost) return;
  const entry = makeActivity(author, text, activity);
  rememberChatEntry(entry);
  appendChatEntry(entry);
  broadcast(entry);
}

function makeId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function rememberChatEntry(entry: ChatEntry) {
  chatHistory.push(entry);
  if (chatHistory.length > 100) chatHistory.shift();
}

function broadcast(message: object) {
  for (const { control } of hostConnections.values()) {
    if (control.open) control.send(message);
  }
}

function loadChatHistory(messages: ChatEntry[]) {
  for (const entry of messages) appendChatEntry(entry, false);
}

function appendChatEntry(entry: ChatEntry, playSound = true) {
  if (entry.type === 'chat-activity') appendChatActivity(entry, playSound);
  else appendChatMessage(entry, playSound);
}

function appendChatActivity(activity: ChatActivity, playSound = true) {
  const container = room.querySelector<HTMLElement>('[data-chat-messages]');
  if (!container || container.querySelector(`[data-message-id="${CSS.escape(activity.id)}"]`)) return;
  container.querySelector('[data-chat-empty]')?.remove();
  const item = document.createElement('div');
  item.className = `chat-activity activity-${activity.activity}`;
  item.dataset.messageId = activity.id;
  const icon = document.createElement('i');
  const text = document.createElement('span');
  const author = document.createElement('strong');
  const time = document.createElement('time');
  author.textContent = activity.author;
  text.append(author, ` ${activity.text}`);
  time.dateTime = new Date(activity.occurredAt).toISOString();
  time.dataset.elapsedAt = String(activity.occurredAt);
  time.textContent = formatElapsedTime(activity.occurredAt);
  item.append(icon, text, time);
  container.append(item);
  trimChatEntries(container);
  container.scrollTop = container.scrollHeight;
  if (playSound) {
    playChatSound();
    if (activity.activity === 'joined' || activity.activity === 'left') {
      roomNotifications.show({
        kind: activity.activity,
        title: `${activity.author} ${activity.text}`,
        description: 'Room activity',
      });
    }
  }
}

function appendChatMessage(message: ChatMessage, playSound = true) {
  const container = room.querySelector<HTMLElement>('[data-chat-messages]');
  if (!container || container.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`)) return;
  container.querySelector('[data-chat-empty]')?.remove();
  const isOwn = session.isHost ? message.sender === 'host' : message.senderId === signaling?.participantId;
  const article = document.createElement('article');
  article.className = `chat-message${isOwn ? ' own' : ''}`;
  article.dataset.messageId = message.id;
  const header = document.createElement('header');
  const author = document.createElement('strong');
  const time = document.createElement('time');
  const body = document.createElement('p');
  author.textContent = isOwn ? 'You' : message.author;
  time.dateTime = new Date(message.sentAt).toISOString();
  time.textContent = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(message.sentAt);
  body.dataset.chatText = message.text;
  chatEmoteRenderer.render(body, message.text);
  header.append(author, time);
  article.append(header, body);
  container.append(article);
  trimChatEntries(container);
  container.scrollTop = container.scrollHeight;
  if (playSound) {
    playChatSound();
    if (!isOwn) {
      roomNotifications.show({ kind: 'message', title: `${message.author} sent a message`, description: message.text });
      markChatUnread();
    }
  }
}

function rerenderChatEmotes() {
  room.querySelectorAll<HTMLElement>('[data-chat-text]').forEach((body) => {
    chatEmoteRenderer.render(body, body.dataset.chatText || '');
  });
}

function sendChat(form: HTMLFormElement) {
  const input = form.querySelector<HTMLInputElement>('[data-chat-input]');
  if (!input) return;
  const text = input.value.trim().slice(0, 500);
  if (!text) return;
  if (session.isHost) {
    const message = makeChatMessage({ sender: 'host', author: 'Host', text });
    rememberChatEntry(message);
    appendChatEntry(message);
    broadcast(message);
  } else if (viewerControl?.open) {
    viewerControl.send({ type: 'chat', text });
  }
  input.value = '';
}

function trimChatEntries(container: HTMLElement) {
  while (container.querySelectorAll('[data-message-id]').length > 100) container.querySelector('[data-message-id]')?.remove();
}

function setChatEnabled(enabled: boolean) {
  const form = room.querySelector<HTMLFormElement>('[data-chat-form]');
  const input = form?.querySelector<HTMLInputElement>('input');
  const button = form?.querySelector<HTMLButtonElement>('button');
  if (input) input.disabled = !enabled;
  if (button) button.disabled = !enabled;
}

function formatElapsedTime(timestamp: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function updateElapsedTimes() {
  document.querySelectorAll<HTMLTimeElement>('[data-elapsed-at]').forEach((time) => {
    const timestamp = Number(time.dataset.elapsedAt);
    if (Number.isFinite(timestamp)) time.textContent = formatElapsedTime(timestamp);
  });
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function toggleCardNotifications() {
  const enabled = roomNotifications.toggle();
  showToast(enabled ? 'Popup notifications enabled.' : 'Popup notifications muted.');
}

function readChatCollapsed() {
  try { return localStorage.getItem('mise-chat-collapsed') === 'yes'; } catch { return false; }
}

function syncChatCollapsed() {
  room.querySelector('.room-workspace')?.classList.toggle('chat-collapsed', chatCollapsed);
  $('#chat-collapse-button').setAttribute('aria-expanded', String(!chatCollapsed));
  $('#chat-expand-button').setAttribute('aria-expanded', String(!chatCollapsed));
}

function markChatUnread() {
  if (chatCollapsed) $('#chat-expand-button').setAttribute('data-unread', '');
}

function setChatCollapsed(collapsed: boolean) {
  chatCollapsed = collapsed;
  try { localStorage.setItem('mise-chat-collapsed', collapsed ? 'yes' : 'no'); } catch {}
  if (!collapsed) $('#chat-expand-button').removeAttribute('data-unread');
  syncChatCollapsed();
  if (!collapsed) queueMicrotask(() => room.querySelector<HTMLInputElement>('[data-chat-input]')?.focus());
}

function readChatSoundsEnabled() {
  try { return localStorage.getItem('mise-chat-sounds') !== 'off'; } catch { return true; }
}

function syncChatSoundButtons() {
  const action = chatSoundsEnabled ? 'Mute notification sounds' : 'Enable notification sounds';
  document.querySelectorAll<HTMLButtonElement>('[data-chat-sound-toggle]').forEach((button) => {
    button.setAttribute('aria-pressed', String(chatSoundsEnabled));
    button.setAttribute('aria-label', action);
    button.title = action;
  });
}

function toggleChatSounds() {
  chatSoundsEnabled = !chatSoundsEnabled;
  try { localStorage.setItem('mise-chat-sounds', chatSoundsEnabled ? 'on' : 'off'); } catch {}
  syncChatSoundButtons();
  if (chatSoundsEnabled) prepareChatAudio();
}

function prepareChatAudio() {
  if (!chatSoundsEnabled) return;
  try {
    chatAudioContext ||= new AudioContext();
    if (chatAudioContext.state === 'suspended') void chatAudioContext.resume();
  } catch {}
}

function playChatSound() {
  if (!chatSoundsEnabled || !chatAudioContext) return;
  try {
    const context = chatAudioContext;
    const play = () => {
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.setValueAtTime(620, now);
      oscillator.frequency.exponentialRampToValueAtTime(820, now + 0.09);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.16);
    };
    if (context.state === 'suspended') void context.resume().then(play).catch(() => {});
    else play();
  } catch {}
}

function endViewer(message: string) {
  if (!session.end()) return;
  stopLocalPresentation();
  disposeConnections();
  setChatEnabled(false);
  $('#stream-button').disabled = true;
  showToast(message, 'error');
}

async function leaveRoom() {
  if (session.isHost) {
    if (!window.confirm('Close this room for everyone?')) return;
    broadcast({ type: 'room-closed' });
    for (const { control } of hostConnections.values()) control.close();
    hostConnections.clear();
    await signaling?.closeRoom().catch(() => {});
  } else {
    await signaling?.leave().catch(() => {});
  }
  disposeLocalPresentation();
  disposeConnections();
  location.href = appPath();
}

function disposeConnections() {
  toggleConnectivityPanel(false);
  connectivityResults.clear();
  viewerControl = undefined;
  signaling?.stop();
  signaling = undefined;
  mesh?.close();
  mesh = undefined;
  peerChannels.clear();
  participantIds.clear();
  participantNames.clear();
  renderParticipantPresence();
  for (const receiver of incomingTextReceivers.values()) receiver.close();
  incomingTextReceivers.clear();
  for (const stream of remoteVideoStreams.values()) {
    for (const track of stream.getTracks()) track.stop();
  }
  remoteVideoStreams.clear();
  for (const audio of remoteAudioElements.values()) audio.srcObject = null;
  remoteAudioElements.clear();
}

async function copyText(value: string, confirmation: string) {
  try { await navigator.clipboard.writeText(value); }
  catch {
    const input = document.createElement('input');
    input.value = value;
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  showToast(confirmation);
}

function setShareAudio(enabled: boolean) {
  shareAudioEnabled = enabled;
  document.querySelectorAll<HTMLInputElement>('[data-share-audio]').forEach((input) => { input.checked = enabled; });
}

function setShareAudioControlsDisabled(disabled: boolean) {
  document.querySelectorAll<HTMLInputElement>('[data-share-audio]').forEach((input) => { input.disabled = disabled; });
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : undefined;
}

function optionalInputValue(selector: string) {
  return document.querySelector<HTMLInputElement>(selector)?.value ?? '';
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

$('#share-button').addEventListener('click', startRoom);
$('#stream-button').addEventListener('click', () => localPresentation ? stopLocalPresentation() : startRoomPresentation());
$('#local-audio-button').addEventListener('click', toggleLocalAudio);
$('#leave-room-button').addEventListener('click', () => void leaveRoom());
$('#copy-room-code').addEventListener('click', () => void copyText(session.roomId, 'Room code copied.'));
$('#copy-invite-button').addEventListener('click', () => void copyText(`${location.origin}${appPath(`room/${session.roomId}`)}`, 'Invite link copied.'));
$('#connection-check-button').addEventListener('click', () => toggleConnectivityPanel());
$('#connection-check-close').addEventListener('click', () => toggleConnectivityPanel(false));
$('#connection-check-run').addEventListener('click', () => void runConnectivityChecks());

document.querySelectorAll<HTMLInputElement>('[data-share-audio]').forEach((input) => {
  input.addEventListener('change', () => setShareAudio(input.checked));
});

room.querySelector<HTMLFormElement>('[data-chat-form]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  sendChat(event.currentTarget as HTMLFormElement);
});

syncChatSoundButtons();
document.querySelectorAll('[data-chat-sound-toggle]').forEach((button) => button.addEventListener('click', toggleChatSounds));
roomNotifications.syncButtons();
document.querySelectorAll('[data-card-notification-toggle]').forEach((button) => button.addEventListener('click', toggleCardNotifications));
syncChatCollapsed();
$('#chat-collapse-button').addEventListener('click', () => setChatCollapsed(true));
$('#chat-expand-button').addEventListener('click', () => setChatCollapsed(false));
document.addEventListener('pointerdown', prepareChatAudio, { once: true, passive: true });
document.addEventListener('keydown', prepareChatAudio, { once: true });
setInterval(updateElapsedTimes, 30_000);

document.querySelectorAll<HTMLElement>('[data-quality-trigger]').forEach((button) => {
  button.addEventListener('click', () => toggleQualityMenu(button));
});
window.addEventListener('resize', positionQualityMenu);
window.addEventListener('scroll', positionQualityMenu, { passive: true, capture: true });
document.querySelectorAll<HTMLElement>('[data-quality]').forEach((button) => {
  button.addEventListener('click', () => {
    const quality = button.dataset.quality;
    if (quality === 'custom') openCustomQuality();
    else if (quality && quality in qualityPresets) void setQuality(quality as PresetName);
  });
});
$('#apply-custom-quality').addEventListener('click', () => void setQuality('custom', customVideoSettings()));
document.addEventListener('fullscreenchange', updateFullscreenButtons);
document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest('[data-quality-trigger]') && !target?.closest('#quality-menu')) closeQualityMenu();
  if (!target?.closest('.connection-check-wrap') && !$('#connection-check-panel').hidden) toggleConnectivityPanel(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#connection-check-panel').hidden) toggleConnectivityPanel(false);
});

$('#join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const id = normalizeRoomCode($('#room-code').value);
  if (!id) return showToast('Enter a valid room code.', 'error');
  history.replaceState({}, '', appPath(`room/${id}`));
  void joinRoom(id);
});

$('#join-password-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const password = joinPasswordInput.value;
  if (!password) {
    joinPasswordError.textContent = 'Enter the room password to continue.';
    joinPasswordError.hidden = false;
    joinPasswordInput.focus();
    return;
  }
  finishPasswordPrompt(password);
});

$('.password-dialog-close').addEventListener('click', () => finishPasswordPrompt(null));
$('.password-cancel').addEventListener('click', () => finishPasswordPrompt(null));
joinPasswordDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  finishPasswordPrompt(null);
});
joinPasswordInput.addEventListener('input', () => { joinPasswordError.hidden = true; });
$('#join-password-visibility').addEventListener('click', () => {
  const button = $('#join-password-visibility');
  const visible = joinPasswordInput.type === 'text';
  joinPasswordInput.type = visible ? 'password' : 'text';
  button.setAttribute('aria-pressed', String(!visible));
  button.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
  $('#join-password-visibility span').textContent = visible ? 'Show' : 'Hide';
  joinPasswordInput.focus();
});

const relativePath = location.pathname.startsWith(appBasePath)
  ? location.pathname.slice(appBasePath.length) || '/'
  : location.pathname;
const routeMatch = relativePath.match(/^\/room\/([a-z0-9-]{6,32})\/?$/i);
if (routeMatch) void joinRoom(routeMatch[1].toLowerCase());
else setScreen('landing');
