import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function MiseshareApp() {
  useEffect(() => {
    void import('@/app')
  }, [])

  return (
    <div>
      <header className="site-header">
        <a className="wordmark" href={import.meta.env.BASE_URL} aria-label="miseshare home">
          <span className="logo-mark" aria-hidden="true">
            <svg aria-hidden="true" viewBox="0 0 40 40">
              <defs>
                <linearGradient
                  id="logo-badge"
                  x1={5}
                  y1={1}
                  x2={35}
                  y2={39}
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset={0} stopColor="#6a8dff" />
                  <stop offset=".52" stopColor="#3158f5" />
                  <stop offset={1} stopColor="#1f3dc4" />
                </linearGradient>
                <linearGradient
                  id="logo-gloss"
                  x1={20}
                  y1={0}
                  x2={20}
                  y2={24}
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset={0} stopColor="#fff" stopOpacity=".32" />
                  <stop offset={1} stopColor="#fff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <rect width={40} height={40} rx="12.5" fill="url(#logo-badge)" />
              <rect width={40} height={40} rx="12.5" fill="url(#logo-gloss)" />
              <rect
                x=".8"
                y=".8"
                width="38.4"
                height="38.4"
                rx="11.8"
                fill="none"
                stroke="#fff"
                strokeOpacity=".26"
                strokeWidth="1.6"
              />
              <g fill="#fff">
                <path
                  fillRule="evenodd"
                  d="M11.5 9.9H28.5A3.5 3.5 0 0 1 32 13.4V21.4A3.5 3.5 0 0 1 28.5 24.9H11.5A3.5 3.5 0 0 1 8 21.4V13.4A3.5 3.5 0 0 1 11.5 9.9ZM20 13.1 24.6 17.7h-2.3v3a1.2 1.2 0 0 1-1.2 1.2h-2.2a1.2 1.2 0 0 1-1.2-1.2v-3h-2.3Z"
                />
                <path d="M18.6 24.9h2.8v2.7h-2.8zM15.4 27.6h9.2a1.2 1.2 0 0 1 0 2.4H15.4a1.2 1.2 0 0 1 0-2.4Z" />
              </g>
            </svg>
          </span>
          <span className="wordmark-text">miseshare</span>
        </a>
        <a
          className="github-link"
          href="https://github.com/michidk/miseshare"
          target="_blank"
          rel="noreferrer"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.88c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.82a9.6 9.6 0 0 1 2.5.34c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.77c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
          </svg>
          <span>Open source</span>
        </a>
      </header>
      <main id="landing" className="landing">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="pulse-dot" /> Free · Open source · Peer to peer
          </div>
          <h1>
            Your people.
            <br />
            <span>Your room.</span>
          </h1>
          <p className="hero-description">
            A private place to chat, share screens, and hang out — without accounts, installs, or a
            subscription.
          </p>
          <section className="feature-pills" aria-label="Room features">
            <span>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2.2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v8Z" />
              </svg>{' '}
              Live chat
            </span>
            <span>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M4 5h16v12H4zM8 21h8M12 17v4" />
              </svg>{' '}
              Multi-screen sharing
            </span>
            <span>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M11 5 6.5 9H3v6h3.5L11 19V5ZM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" />
              </svg>{' '}
              Shared audio
            </span>
            <span>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" />
              </svg>{' '}
              P2P file transfers
            </span>
          </section>
          <section className="hero-actions" aria-label="Room actions">
            <section className="room-action-card start-room-card">
              <div className="action-card-heading">
                <span className="action-card-icon" aria-hidden="true">
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 14.5v-9ZM8 20h8M12 16v4" />
                  </svg>
                </span>
                <span>
                  <small>Bring people together</small>
                  <strong>Create a room</strong>
                </span>
              </div>
              <p>
                Invite anyone you like — the room stays open until the service limit is reached.
              </p>
              <div className="room-create-options">
                <label htmlFor="room-password">
                  <span>
                    Password <small>Optional</small>
                  </span>
                  <Input
                    id="room-password"
                    type="password"
                    maxLength={128}
                    autoComplete="new-password"
                    placeholder="Add a password"
                  />
                </label>
              </div>
              <Button id="share-button" variant="primary" type="button">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 14.5v-9ZM8 20h8M12 16v4" />
                </svg>
                Start room
              </Button>
            </section>
            <form id="join-form" className="room-action-card join-form">
              <div className="action-card-heading">
                <span className="action-card-icon" aria-hidden="true">
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M14 8l4 4-4 4M18 12H8M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5" />
                  </svg>
                </span>
                <span>
                  <small>Have an invite?</small>
                  <strong>Drop into a room</strong>
                </span>
              </div>
              <p>Enter a room code and join your people instantly.</p>
              <label className="room-field" htmlFor="room-code">
                <span>Room code</span>
                <Input
                  id="room-code"
                  autoComplete="off"
                  spellCheck="false"
                  placeholder="e.g. abcd-2345"
                  maxLength={32}
                />
              </label>
              <Button className="join-button" type="submit">
                Join room
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </Button>
            </form>
          </section>
          <section className="trust-row" aria-label="Service features">
            <span>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z" />
              </svg>{' '}
              Peer-to-peer media
            </span>
            <span>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M4 7h16M7 4v6M17 4v6M5 20h14V7H5z" />
                <path d="m9 15 2 2 4-4" />
              </svg>{' '}
              Works in your browser
            </span>
            <span>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7l-8-4Z" />
                <path d="m9 12 2 2 4-4" />
              </svg>{' '}
              No ads or paywalls
            </span>
          </section>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="browser-card room-preview">
            <div className="browser-bar">
              <i />
              <i />
              <i />
              <span />
            </div>
            <div className="browser-body">
              <div className="mini-content">
                <div className="mini-room-heading">
                  <span>
                    <small>LIVE ROOM</small>
                    <strong>Friday hangout</strong>
                  </span>
                  <div className="mini-avatars">
                    <i>J</i>
                    <i>M</i>
                    <i>A</i>
                  </div>
                </div>
                <div className="mini-stage">
                  <div className="mini-stream">
                    <span className="mini-window">
                      <i />
                      <i />
                      <i />
                    </span>
                    <b>Jamie is sharing</b>
                  </div>
                  <div className="mini-chat">
                    <strong>Room chat</strong>
                    <p>
                      <i>J</i>
                      <span>
                        <b>Jamie</b>what are we playing?
                      </span>
                    </p>
                    <p>
                      <i>M</i>
                      <span>
                        <b>Morgan</b>give me two mins 👋
                      </span>
                    </p>
                    <div>
                      Message the room… <b>➤</b>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="live-chip">
              <span /> Room is live
            </div>
          </div>
          <div className="viewer-bubble">
            <span className="avatar">AK</span>
            <span>
              <strong>Alex joined the room</strong>
              <small>Just now</small>
            </span>
          </div>
        </div>
        <div className="landing-footnote">
          Media is encrypted between browsers and requires a direct peer-to-peer connection. Room
          metadata is stored briefly to keep everyone connected.
        </div>
      </main>
      <main id="room" className="room-experience" hidden>
        <div className="room-topbar">
          <div className="room-identity">
            <h1 id="room-title">Room</h1>
          </div>
          <div className="room-topbar-actions">
            <section className="participant-presence" aria-label="Room participants">
              <div id="participant-avatars" className="participant-avatars" />
              <div className="participant-count">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M16 20v-1.5c0-2-1.8-3.5-4-3.5s-4 1.5-4 3.5V20M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM18 9a3 3 0 0 1 0 6M20 20v-1c0-1.4-.8-2.5-2-3" />
                </svg>
                <span data-participant-count>1 participant</span>
              </div>
            </section>
            <div className="connection-check-wrap">
              <button
                id="connection-check-button"
                className="connection-check-button"
                type="button"
                aria-expanded="false"
                aria-controls="connection-check-panel"
                title="Check peer connections"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx={12} cy={5} r={2} />
                  <circle cx={5} cy={18} r={2} />
                  <circle cx={19} cy={18} r={2} />
                  <path d="M12 7v4M5 16v-2a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v2" />
                </svg>
                <span>Connection</span>
              </button>
              <section
                id="connection-check-panel"
                className="connection-check-panel"
                aria-labelledby="connection-check-title"
                hidden
              >
                <header>
                  <div>
                    <span>Peer-to-peer diagnostics</span>
                    <h2 id="connection-check-title">Connection check</h2>
                  </div>
                  <button
                    id="connection-check-close"
                    type="button"
                    aria-label="Close connection check"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </header>
                <div
                  id="connection-check-summary"
                  className="connection-check-summary"
                  data-quality="idle"
                >
                  <span className="connection-summary-icon">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>
                    <strong>Ready to check</strong>
                    <small>Tests only run while this panel is open.</small>
                  </span>
                </div>
                <div
                  id="connection-check-results"
                  className="connection-check-results"
                  aria-live="polite"
                />
                <footer>
                  <span>A brief 512 KB transfer measures each browser connection.</span>
                  <button id="connection-check-run" type="button">
                    Run again
                  </button>
                </footer>
              </section>
            </div>
            <button
              id="drop-button"
              className="drop-button"
              type="button"
              aria-label="Transfer files"
              disabled
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 16V4m0 0L8 8m4-4 4 4M5 15v4h14v-4" />
              </svg>
              <span>Transfer files</span>
              <i id="drop-button-badge" hidden />
            </button>
            <button
              id="copy-room-code"
              className="room-code-pill"
              type="button"
              title="Copy room code"
            >
              <span>Room</span>
              <b id="room-code-display" />
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M8 8h11v11H8zM5 16V5h11" />
              </svg>
            </button>
            <button id="leave-room-button" className="close-room-button" type="button">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
              <span>Leave room</span>
            </button>
          </div>
        </div>
        <div className="room-workspace">
          <section className="streams-panel" aria-label="Shared screens">
            <div className="streams-heading">
              <span id="stream-count" className="stream-count">
                No active streams
              </span>
            </div>
            <div id="stream-grid" className="stream-grid" aria-live="polite" />
            <div id="streams-empty" className="streams-empty">
              <span className="empty-screen-icon">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M4 5h16v12H4zM8 21h8M12 17v4" />
                </svg>
              </span>
              <h2>No one is sharing yet</h2>
              <p>Start a stream and it will appear here for everyone in the room.</p>
            </div>
            <section className="stream-controls" aria-label="Your stream controls">
              <div className="stream-control-copy">
                <span>Your stream</span>
                <strong id="your-stream-status">Not sharing</strong>
              </div>
              <label id="share-audio-option" className="audio-option audio-option-compact">
                <input type="checkbox" data-share-audio />
                <span className="audio-switch" aria-hidden="true">
                  <i />
                </span>
                <span>Include audio</span>
              </label>
              <Button id="local-audio-button" className="audio-control-button" type="button" hidden>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
                  <path
                    className="audio-control-waves"
                    d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"
                  />
                  <path className="audio-control-muted-line" d="m4 4 16 16" />
                  <path className="audio-control-add" d="M18 4v6M15 7h6" />
                </svg>
                <span className="sr-only">Start audio</span>
              </Button>
              <Button
                id="local-microphone-button"
                className="microphone-control-button"
                type="button"
                hidden
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x={9} y={3} width={6} height={11} rx={3} />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
                  <path className="microphone-control-add" d="M19 3v6M16 6h6" />
                </svg>
                <span className="sr-only">Share microphone</span>
              </Button>
              <div className="quality-settings">
                <button
                  id="quality-button"
                  className="quality-button"
                  data-quality-trigger
                  type="button"
                  aria-expanded="false"
                  aria-controls="quality-menu"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
                    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
                  </svg>
                  <span id="quality-label">720p</span>
                  <svg aria-hidden="true" className="chevron" viewBox="0 0 24 24">
                    <path d="m8 10 4 4 4-4" />
                  </svg>
                </button>
              </div>
              <Button
                id="test-stream-button"
                className="test-stream-button"
                type="button"
                hidden
                disabled
                title="Start an animated synthetic stream without opening the screen picker"
              >
                Test stream
              </Button>
              <Button
                id="stream-button"
                className="stream-button"
                variant="primary"
                type="button"
                disabled
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M4 5h16v12H4zM8 21h8M12 17v4" />
                </svg>
                <span>Start sharing</span>
              </Button>
            </section>
          </section>
          <aside className="room-sidebar">
            <section className="invite-strip">
              <div>
                <span>Invite people</span>
                <strong>Share this room</strong>
              </div>
              <Button id="copy-invite-button" variant="secondary" type="button">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
                </svg>
                <span>Copy link</span>
              </Button>
            </section>
            <section className="chat-panel" aria-label="Room chat and activity">
              <div className="chat-heading">
                <div>
                  <span className="chat-live-dot" />
                  <h2>Chat &amp; activity</h2>
                </div>
                <div className="chat-heading-actions">
                  <span data-participant-count>1 participant</span>
                  <button
                    className="chat-action-toggle"
                    data-card-notification-toggle
                    type="button"
                    aria-label="Turn off popup notifications"
                    aria-pressed="true"
                    aria-describedby="popup-notifications-help"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 3v-4.3A2 2 0 0 1 3 15V7a2 2 0 0 1 2-2Z" />
                      <path className="chat-toggle-off" d="m4 4 16 16" />
                    </svg>
                    <span id="popup-notifications-help" className="control-popover" role="tooltip">
                      <strong>Popup notifications</strong>
                      <span data-card-notification-description>
                        On · New room activity appears as popup cards.
                      </span>
                    </span>
                  </button>
                  <button
                    className="chat-sound-toggle"
                    data-chat-sound-toggle
                    type="button"
                    aria-label="Mute notification sounds"
                    aria-pressed="true"
                    aria-describedby="notification-sounds-help"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
                      <path className="chat-sound-off" d="m4 4 16 16" />
                    </svg>
                    <span id="notification-sounds-help" className="control-popover" role="tooltip">
                      <strong>Notification sounds</strong>
                      <span data-chat-sound-description>
                        On · A sound plays for new messages and activity.
                      </span>
                    </span>
                  </button>
                  <button
                    className="chat-action-toggle"
                    id="chat-collapse-button"
                    type="button"
                    aria-label="Collapse chat"
                    aria-describedby="collapse-chat-help"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m14 7-5 5 5 5" />
                      <path d="M20 4v16" />
                    </svg>
                    <span id="collapse-chat-help" className="control-popover" role="tooltip">
                      <strong>Collapse chat</strong>
                      <span>Hide this panel to give shared screens more room.</span>
                    </span>
                  </button>
                </div>
              </div>
              <div className="chat-messages" data-chat-messages>
                <div className="chat-empty" data-chat-empty>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2.2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v8Z" />
                  </svg>
                  <span>Room events and messages appear here.</span>
                </div>
              </div>
              <form className="chat-form" data-chat-form>
                <label className="sr-only" htmlFor="chat-input">
                  Chat message
                </label>
                <Input
                  id="chat-input"
                  data-chat-input
                  maxLength={500}
                  autoComplete="off"
                  placeholder="Message the room…"
                  disabled
                />
                <button type="submit" aria-label="Send message" disabled>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="m21 3-7.5 18-3.6-7-6.9-3.5L21 3Z" />
                    <path d="m10 14 4-4" />
                  </svg>
                </button>
              </form>
            </section>
          </aside>
          <button
            id="chat-expand-button"
            className="chat-expand-button"
            type="button"
            aria-label="Open chat"
            title="Open chat"
          >
            <span className="chat-expand-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2.2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v8Z" />
              </svg>
              <i className="chat-expand-dot" aria-hidden="true" />
            </span>
            <span className="chat-expand-label">Chat</span>
          </button>
        </div>
        <p className="room-privacy">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z" />
          </svg>{' '}
          Streams and file transfers are encrypted between browsers; file contents never pass
          through the server.
        </p>
      </main>
      <section
        id="room-status"
        className="room-status"
        aria-live="assertive"
        aria-labelledby="room-status-title"
        hidden
      >
        <div className="room-status-card">
          <span id="room-status-spinner" className="room-status-spinner" aria-hidden="true" />
          <span id="room-status-kicker" className="room-status-kicker">
            Connecting
          </span>
          <h2 id="room-status-title">Connecting to the room…</h2>
          <p id="room-status-message">
            Hang tight while we establish a secure peer-to-peer connection.
          </p>
          <a
            id="room-status-home"
            className="button button-primary room-status-home"
            href="./"
            hidden
          >
            Back to home
          </a>
        </div>
      </section>
      <div id="quality-menu" className="quality-menu" hidden>
        <div className="quality-menu-heading">
          <strong>Stream quality</strong>
          <span>Applied live</span>
        </div>
        <button type="button" data-quality="text">
          <span>
            <strong>Text</strong>
            <small>Native resolution · 6 fps · pixel-perfect</small>
          </span>
          <i />
        </button>
        <button type="button" data-quality="720p" className="active">
          <span>
            <strong>720p</strong>
            <small>30 fps · balanced bandwidth</small>
          </span>
          <i />
        </button>
        <button type="button" data-quality="720p60">
          <span>
            <strong>720p 60 FPS</strong>
            <small>Smoother motion · higher bandwidth</small>
          </span>
          <i />
        </button>
        <button type="button" data-quality="1080p">
          <span>
            <strong>1080p</strong>
            <small>30 fps · sharper video</small>
          </span>
          <i />
        </button>
        <button type="button" data-quality="1080p60">
          <span>
            <strong>1080p 60 FPS</strong>
            <small>Sharpest preset · highest bandwidth</small>
          </span>
          <i />
        </button>
        <button
          type="button"
          data-quality="custom"
          aria-expanded="false"
          aria-controls="custom-quality-panel"
        >
          <span>
            <strong>Custom</strong>
            <small>Choose resolution, frame rate, and compression</small>
          </span>
          <i />
        </button>
        <div id="custom-quality-panel" className="advanced-panel" hidden>
          <label>
            <span>Resolution</span>
            <select id="custom-resolution" defaultValue="1920x1080">
              <option value="1280x720">720p</option>
              <option value="1920x1080">1080p</option>
              <option value="2560x1440">1440p</option>
              <option value="3840x2160">4K</option>
            </select>
          </label>
          <label>
            <span>Frame rate</span>
            <select id="custom-frame-rate" defaultValue="30">
              <option value={15}>15 fps</option>
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </label>
          <label>
            <span>Compression</span>
            <select id="custom-compression" defaultValue="balanced">
              <option value="high">High · less bandwidth</option>
              <option value="balanced">Balanced</option>
              <option value="low">Low · best quality</option>
            </select>
          </label>
          <button id="apply-custom-quality" className="apply-advanced" type="button">
            Apply custom settings
          </button>
        </div>
        <div className="bandwidth-card">
          <div>
            <span>Estimated upload</span>
            <strong id="bandwidth-total">0 Mbps</strong>
          </div>
          <small id="bandwidth-detail">Content-dependent lossless deltas × 1 peer</small>
          <small id="bandwidth-capacity">
            Text mode is lossless; motion can use substantially more bandwidth.
          </small>
        </div>
      </div>
      <dialog id="drop-dialog" className="drop-dialog" aria-labelledby="drop-title">
        <div className="drop-dialog-shell">
          <header>
            <span className="drop-dialog-icon" aria-hidden="true">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" />
              </svg>
            </span>
            <span>
              <small>Peer-to-peer sharing</small>
              <strong id="drop-title">Transfer files</strong>
            </span>
            <button id="drop-dialog-close" type="button" aria-label="Close file transfers">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </header>
          <label id="drop-zone" className="drop-zone" htmlFor="drop-file-input">
            <input id="drop-file-input" type="file" multiple hidden />
            <span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 16V4m0 0L8 8m4-4 4 4M5 15v4h14v-4" />
              </svg>
            </span>
            <strong>Choose files or drop them here</strong>
            <small>
              Sent directly to everyone in the room after they accept · up to 256 MB each
            </small>
          </label>
          <section className="drop-transfers" aria-labelledby="drop-transfers-title">
            <div className="drop-transfers-heading">
              <strong id="drop-transfers-title">Transfers</strong>
              <span id="drop-peer-count">No peers connected</span>
            </div>
            <div id="drop-transfer-list" className="drop-transfer-list" aria-live="polite">
              <p className="drop-empty">Files you send or receive will appear here.</p>
            </div>
          </section>
          <p className="drop-privacy">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z" />
            </svg>
            <span>
              File bytes travel over the room’s encrypted WebRTC connections. Nothing is uploaded or
              stored by miseshare.
            </span>
          </p>
        </div>
      </dialog>
      <dialog
        id="join-password-dialog"
        className="password-dialog"
        aria-labelledby="join-password-title"
      >
        <form id="join-password-form" method="dialog">
          <button className="password-dialog-close" type="button" aria-label="Cancel joining room">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          <span className="password-dialog-icon" aria-hidden="true">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z" />
            </svg>
          </span>
          <span className="password-dialog-kicker">Protected room</span>
          <h2 id="join-password-title">Enter room password</h2>
          <p>
            Room <strong id="join-password-room" /> requires a password from its host.
          </p>
          <label htmlFor="join-password">Password</label>
          <div className="password-input-wrap">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z" />
            </svg>
            <Input
              id="join-password"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              placeholder="Enter password"
            />
            <button
              id="join-password-visibility"
              type="button"
              aria-label="Show password"
              aria-pressed="false"
            >
              <span>Show</span>
            </button>
          </div>
          <p id="join-password-error" className="password-dialog-error" role="alert" hidden />
          <div className="password-dialog-actions">
            <Button className="password-cancel" type="button">
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Join room
            </Button>
          </div>
        </form>
      </dialog>
      <section
        id="notification-toaster"
        className="notification-toaster"
        aria-label="Room notifications"
        aria-live="polite"
        aria-atomic="false"
      />
      <div id="toast" className="toast" role="status" aria-live="polite" />
    </div>
  )
}
