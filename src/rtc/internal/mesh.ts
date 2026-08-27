import type { OutgoingSignal, SignalEnvelope } from '../../signaling/index.js';
import { NativeRtcChannel } from './channel.js';
import type { RtcConnectionStats, RtcMeshEvents, RtcPeerChannels } from '../types.js';

interface PeerState extends RtcPeerChannels {
  connection: RTCPeerConnection;
  audioSender: RTCRtpSender;
  videoSender: RTCRtpSender;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingRemoteAnswer: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  tracksReady: Promise<void>;
  recoveryAttempts: number;
  recoveryTimer?: ReturnType<typeof setTimeout>;
}

export class RtcMesh {
  private readonly peers = new Map<string, PeerState>();
  private audioTrack: MediaStreamTrack | null = null;
  private videoTrack: MediaStreamTrack | null = null;
  private videoBitrate: number | undefined;
  private closed = false;

  constructor(
    private readonly localPeerId: string,
    private configuration: RTCConfiguration,
    private readonly sendSignal: (signal: OutgoingSignal) => Promise<void>,
    private readonly events: Partial<RtcMeshEvents> = {},
  ) {}

  connect(peerId: string) {
    const peer = this.ensurePeer(peerId);
    void peer.tracksReady.then(() => this.negotiate(peer));
    return peer;
  }

  peer(peerId: string) {
    return this.peers.get(peerId);
  }

  async connectionStats(peerId: string): Promise<RtcConnectionStats | undefined> {
    const peer = this.peers.get(peerId);
    if (!peer) return undefined;
    const report = await peer.connection.getStats();
    let selectedPairId = '';
    let selectedPair: RTCStats | undefined;
    let lostPackets = 0;
    let receivedPackets = 0;
    report.forEach((stat) => {
      const fields = stat as RTCStats & Record<string, unknown>;
      if (stat.type === 'transport' && typeof fields.selectedCandidatePairId === 'string') {
        selectedPairId = fields.selectedCandidatePairId;
      }
      if (stat.type === 'candidate-pair'
        && (fields.selected === true || (fields.nominated === true && fields.state === 'succeeded'))) {
        selectedPair = stat;
      }
      if (!['inbound-rtp', 'remote-inbound-rtp'].includes(stat.type)) return;
      if (typeof fields.packetsLost === 'number' && fields.packetsLost > 0) lostPackets += fields.packetsLost;
      if (typeof fields.packetsReceived === 'number' && fields.packetsReceived > 0) receivedPackets += fields.packetsReceived;
    });
    if (selectedPairId) selectedPair = report.get(selectedPairId) ?? selectedPair;
    const pair = selectedPair as (RTCStats & Record<string, unknown>) | undefined;
    const localCandidate = typeof pair?.localCandidateId === 'string' ? report.get(pair.localCandidateId) : undefined;
    const remoteCandidate = typeof pair?.remoteCandidateId === 'string' ? report.get(pair.remoteCandidateId) : undefined;
    const candidateTypes = [localCandidate, remoteCandidate]
      .map((candidate) => (candidate as (RTCStats & Record<string, unknown>) | undefined)?.candidateType)
      .filter((type): type is string => typeof type === 'string');
    const route = candidateTypes.includes('relay')
      ? 'relay'
      : candidateTypes.length ? 'direct' : 'unknown';
    const packetTotal = lostPackets + receivedPackets;
    return {
      route,
      packetLossPercent: packetTotal > 0 ? (lostPackets / packetTotal) * 100 : undefined,
    };
  }

  async handleSignal(signal: SignalEnvelope) {
    if (this.closed || signal.recipientId !== this.localPeerId || signal.senderId === this.localPeerId) return;
    const peer = this.ensurePeer(signal.senderId);
    try {
      if (signal.kind === 'description') {
        const description = signal.payload as RTCSessionDescriptionInit;
        if (!description || !['offer', 'answer'].includes(description.type)) return;
        const readyForOffer = !peer.makingOffer
          && (peer.connection.signalingState === 'stable' || peer.settingRemoteAnswer);
        const offerCollision = description.type === 'offer' && !readyForOffer;
        const polite = this.localPeerId.localeCompare(peer.peerId) > 0;
        peer.ignoreOffer = !polite && offerCollision;
        if (peer.ignoreOffer) return;
        peer.settingRemoteAnswer = description.type === 'answer';
        await peer.tracksReady;
        await peer.connection.setRemoteDescription(description);
        peer.settingRemoteAnswer = false;
        if (description.type === 'offer') {
          await peer.connection.setLocalDescription();
          await this.send(peer.peerId, 'description', peer.connection.localDescription?.toJSON());
        }
        for (const candidate of peer.pendingCandidates.splice(0)) {
          try {
            await peer.connection.addIceCandidate(candidate);
          } catch (error) {
            if (!peer.ignoreOffer) this.events.error?.(peer.peerId, asError(error));
          }
        }
        return;
      }
      const candidate = signal.payload as RTCIceCandidateInit;
      if (!candidate || typeof candidate.candidate !== 'string') return;
      if (!peer.connection.remoteDescription) {
        peer.pendingCandidates.push(candidate);
        return;
      }
      try {
        await peer.connection.addIceCandidate(candidate);
      } catch (error) {
        if (!peer.ignoreOffer) throw error;
      }
    } catch (error) {
      this.events.error?.(peer.peerId, asError(error));
    }
  }

  async setAudioTrack(track: MediaStreamTrack | null) {
    this.audioTrack = track;
    await Promise.all([...this.peers.values()].map((peer) => peer.audioSender.replaceTrack(track)));
  }

  async setVideoTrack(track: MediaStreamTrack | null, bitrate?: number) {
    this.videoTrack = track;
    this.videoBitrate = bitrate;
    await Promise.all([...this.peers.values()].map(async (peer) => {
      await peer.videoSender.replaceTrack(track);
      await this.applyVideoBitrate(peer.videoSender);
    }));
  }

  closePeer(peerId: string) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    clearTimeout(peer.recoveryTimer);
    peer.control.close();
    peer.screen.close();
    peer.diagnostics.close();
    peer.connection.close();
    this.events.peerClosed?.(peerId);
  }

  close() {
    this.closed = true;
    for (const peerId of [...this.peers.keys()]) this.closePeer(peerId);
  }

  private ensurePeer(peerId: string) {
    const existing = this.peers.get(peerId);
    if (existing) return existing;
    if (this.closed || !validPeerId(peerId) || peerId === this.localPeerId) throw new Error('Cannot create an invalid peer connection.');
    const connection = new RTCPeerConnection(this.configuration);
    const control = new NativeRtcChannel(peerId, connection.createDataChannel('control', { negotiated: true, id: 0, ordered: true }));
    const screen = new NativeRtcChannel(peerId, connection.createDataChannel('screen', { negotiated: true, id: 1, ordered: true }));
    const diagnostics = new NativeRtcChannel(peerId, connection.createDataChannel('diagnostics', { negotiated: true, id: 2, ordered: true }));
    const audioSender = connection.addTransceiver(this.audioTrack ?? 'audio', { direction: 'sendrecv' }).sender;
    const videoSender = connection.addTransceiver(this.videoTrack ?? 'video', { direction: 'sendrecv' }).sender;
    const peer: PeerState = {
      peerId,
      connection,
      control,
      screen,
      diagnostics,
      audioSender,
      videoSender,
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      pendingCandidates: [],
      tracksReady: Promise.resolve(),
      recoveryAttempts: 0,
    };
    this.peers.set(peerId, peer);
    this.events.peerAvailable?.(peer);
    connection.addEventListener('icecandidate', (event) => {
      if (event.candidate) void this.send(peerId, 'candidate', event.candidate.toJSON());
    });
    connection.addEventListener('negotiationneeded', () => void this.negotiate(peer));
    connection.addEventListener('track', (event) => this.events.mediaTrack?.(peerId, event.track, event.streams));
    connection.addEventListener('connectionstatechange', () => {
      const state = connection.connectionState;
      this.events.connectionState?.(peerId, state);
      if (state === 'connected') {
        peer.recoveryAttempts = 0;
        clearTimeout(peer.recoveryTimer);
        peer.recoveryTimer = undefined;
      } else if (state === 'disconnected') {
        this.scheduleRecovery(peer, 5_000);
      } else if (state === 'failed') {
        clearTimeout(peer.recoveryTimer);
        peer.recoveryTimer = undefined;
        this.scheduleRecovery(peer, 250);
      } else if (state === 'closed') {
        this.closePeer(peerId);
      }
    });
    peer.tracksReady = this.videoTrack ? this.applyVideoBitrate(videoSender) : Promise.resolve();
    return peer;
  }

  private async applyVideoBitrate(sender: RTCRtpSender) {
    if (!this.videoBitrate) return;
    const parameters = sender.getParameters();
    parameters.encodings ||= [{}];
    parameters.encodings[0].maxBitrate = this.videoBitrate;
    try { await sender.setParameters(parameters); } catch {}
  }

  private async negotiate(peer: PeerState) {
    if (this.closed || peer.makingOffer || peer.connection.signalingState !== 'stable') return;
    try {
      peer.makingOffer = true;
      await peer.tracksReady;
      await peer.connection.setLocalDescription();
      await this.send(peer.peerId, 'description', peer.connection.localDescription?.toJSON());
    } catch (error) {
      this.events.error?.(peer.peerId, asError(error));
    } finally {
      peer.makingOffer = false;
    }
  }

  private scheduleRecovery(peer: PeerState, delayMs: number) {
    if (this.closed || peer.recoveryTimer || !this.peers.has(peer.peerId)) return;
    if (peer.recoveryAttempts >= 3) {
      this.events.error?.(peer.peerId, new Error('The peer connection could not be recovered.'));
      this.closePeer(peer.peerId);
      return;
    }
    this.events.connectionState?.(peer.peerId, 'recovering');
    peer.recoveryTimer = setTimeout(() => {
      peer.recoveryTimer = undefined;
      void this.recoverPeer(peer);
    }, delayMs);
  }

  private async recoverPeer(peer: PeerState) {
    if (this.closed || !this.peers.has(peer.peerId) || connectionIsConnected(peer.connection)) return;
    peer.recoveryAttempts += 1;
    if (this.events.refreshConfiguration) {
      try {
        const refreshed = await this.events.refreshConfiguration();
        this.configuration = refreshed;
        peer.connection.setConfiguration(refreshed);
      } catch (error) {
        this.events.error?.(peer.peerId, asError(error));
      }
    }
    if (this.closed || !this.peers.has(peer.peerId) || connectionIsConnected(peer.connection)) return;
    try {
      peer.connection.restartIce();
      await this.negotiate(peer);
    } catch (error) {
      this.events.error?.(peer.peerId, asError(error));
    }
    this.scheduleRecovery(peer, Math.min(8_000, 1_000 * 2 ** peer.recoveryAttempts));
  }

  private async send(recipientId: string, kind: OutgoingSignal['kind'], payload: unknown) {
    if (payload !== undefined) await this.sendSignal({ recipientId, kind, payload });
  }
}

function validPeerId(value: string) {
  return /^[A-Za-z0-9_-]{8,40}$/.test(value);
}

function connectionIsConnected(connection: RTCPeerConnection) {
  return connection.connectionState === 'connected';
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value));
}
