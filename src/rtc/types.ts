export type ChannelEvent = 'open' | 'message' | 'drain' | 'close' | 'error';

export interface RtcChannel {
  readonly peerId: string;
  readonly open: boolean;
  readonly bufferedAmount: number;
  send(value: unknown): void;
  close(): void;
  on(event: 'message', listener: (value: unknown) => void): void;
  on(event: Exclude<ChannelEvent, 'message'>, listener: () => void): void;
  off(event: 'message', listener: (value: unknown) => void): void;
  off(event: Exclude<ChannelEvent, 'message'>, listener: () => void): void;
}

export interface RtcPeerChannels {
  peerId: string;
  control: RtcChannel;
  screen: RtcChannel;
  diagnostics: RtcChannel;
  drop: RtcChannel;
}

export interface RtcConnectionStats {
  route: 'direct' | 'relay' | 'unknown';
  packetLossPercent?: number;
}

export type RtcSignal =
  | { kind: 'description'; payload: RTCSessionDescriptionInit }
  | { kind: 'candidate'; payload: RTCIceCandidateInit };

export interface RtcMeshEvents {
  peerAvailable(peer: RtcPeerChannels): void;
  peerClosed(peerId: string): void;
  mediaTrack(peerId: string, track: MediaStreamTrack, streams: readonly MediaStream[]): void;
  connectionState(peerId: string, state: RTCPeerConnectionState | 'recovering'): void;
  refreshConfiguration(): Promise<RTCConfiguration>;
  error(peerId: string, error: Error): void;
}
