import type {
  CreateRoomRequest,
  JoinRoomRequest,
  OutgoingSignal,
  RoomCredentials,
  SignalBatch,
  SignalEnvelope,
} from '../types.js';

const HEARTBEAT_MS = 20_000;
const ACTIVE_POLL_MS = 400;
const IDLE_POLL_MS = 2_500;
const HIDDEN_POLL_MS = 5_000;

export class SignalingError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

export class RestSignalingSession {
  readonly roomId: string;
  readonly participantId: string;
  readonly participantToken: string;
  readonly hostId: string;
  readonly participants: RoomCredentials['participants'];
  readonly participant: RoomCredentials['participant'];
  private readonly abortController = new AbortController();
  private readonly listeners = new Set<(signal: SignalEnvelope) => void | Promise<void>>();
  private readonly unavailableListeners = new Set<() => void>();
  private cursor = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private polling = false;

  constructor(private readonly apiBase: string, credentials: RoomCredentials) {
    this.roomId = credentials.roomId;
    this.participantId = credentials.participant.id;
    this.participantToken = credentials.participantToken;
    this.hostId = credentials.hostId;
    this.participants = credentials.participants;
    this.participant = credentials.participant;
  }

  onSignal(listener: (signal: SignalEnvelope) => void | Promise<void>) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onUnavailable(listener: () => void) {
    this.unavailableListeners.add(listener);
    return () => this.unavailableListeners.delete(listener);
  }

  start() {
    if (this.polling) return;
    this.polling = true;
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
    void this.pollLoop();
  }

  async send(signal: OutgoingSignal) {
    await this.request(`/rooms/${this.roomId}/signals`, { method: 'POST', body: JSON.stringify(signal) });
  }

  async leave() {
    try {
      await this.request(`/rooms/${this.roomId}/participants/me`, { method: 'DELETE', keepalive: true });
    } finally {
      this.stop();
    }
  }

  async closeRoom() {
    try {
      await this.request(`/rooms/${this.roomId}`, { method: 'DELETE', keepalive: true });
    } finally {
      this.stop();
    }
  }

  depart() {
    const pathname = this.participant.isHost
      ? `/rooms/${this.roomId}`
      : `/rooms/${this.roomId}/participants/me`;
    void fetch(`${this.apiBase}${pathname}`, {
      method: 'DELETE',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.participantToken}`,
        'X-Participant-Id': this.participantId,
      },
    }).catch(() => {});
    this.stop();
  }

  stop() {
    this.polling = false;
    this.abortController.abort();
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private async heartbeat() {
    try {
      await this.request(`/rooms/${this.roomId}/heartbeat`, { method: 'POST', body: '{}' });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        if (error instanceof SignalingError && [401, 404].includes(error.status)) {
          this.stop();
          for (const listener of this.unavailableListeners) listener();
        }
      }
    }
  }

  private async pollLoop() {
    let retryMs = ACTIVE_POLL_MS;
    let idlePolls = 0;
    while (this.polling) {
      try {
        const batch = await this.request<SignalBatch>(`/rooms/${this.roomId}/signals?after=${this.cursor}`);
        this.cursor = batch.cursor;
        for (const signal of batch.signals) {
          for (const listener of this.listeners) await listener(signal);
        }
        if (batch.signals.length) {
          idlePolls = 0;
          retryMs = 30;
        } else {
          idlePolls += 1;
          retryMs = Math.min(IDLE_POLL_MS, ACTIVE_POLL_MS * 2 ** Math.floor(idlePolls / 4));
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') retryMs = HIDDEN_POLL_MS;
        }
      } catch (error) {
        if (!this.polling || error instanceof DOMException && error.name === 'AbortError') return;
        if (error instanceof SignalingError && [401, 404].includes(error.status)) {
          this.stop();
          for (const listener of this.unavailableListeners) listener();
          return;
        }
        retryMs = Math.min(HIDDEN_POLL_MS, retryMs * 2);
      }
      await delay(retryMs, this.abortController.signal).catch(() => {});
    }
  }

  private async request<Result = void>(pathname: string, init: RequestInit = {}): Promise<Result> {
    const response = await fetch(`${this.apiBase}${pathname}`, {
      ...init,
      signal: this.abortController.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.participantToken}`,
        'X-Participant-Id': this.participantId,
        ...init.headers,
      },
    });
    if (!response.ok) throw await responseError(response);
    return response.status === 204 || response.status === 202 ? undefined as Result : response.json() as Promise<Result>;
  }
}

export async function createRoom(apiBase: string, input: CreateRoomRequest) {
  return new RestSignalingSession(apiBase, await publicRequest<RoomCredentials>(`${apiBase}/rooms`, input));
}

export async function joinRoom(apiBase: string, roomId: string, input: JoinRoomRequest) {
  return new RestSignalingSession(apiBase, await publicRequest<RoomCredentials>(`${apiBase}/rooms/${roomId}/join`, input));
}

async function publicRequest<Result>(url: string, body: object): Promise<Result> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<Result>;
}

async function responseError(response: Response) {
  const result = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
  return new SignalingError(
    result.error?.code ?? 'request-failed',
    result.error?.message ?? `The room request failed (${response.status}).`,
    response.status,
  );
}

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}
