import { useRouterState } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface DashboardState {
  content: string
  generatedAt: number
  title: string
  view: AdminView
}

type AdminView = 'overview' | 'sessions' | 'participants' | 'signals'

const adminBaseUrl = `${import.meta.env.BASE_URL}admin/`

export function AdminPage() {
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const [dashboard, setDashboard] = useState<DashboardState>()
  const [authenticated, setAuthenticated] = useState<boolean>()
  const [loadError, setLoadError] = useState<string>()
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    void retry
    let active = true
    const load = async () => {
      try {
        const response = await fetch(`${adminBaseUrl}data${search}`, {
          headers: { accept: 'application/json' },
        })
        if (!active) return
        if (response.status === 401) {
          setAuthenticated(false)
          setDashboard(undefined)
          setLoadError(undefined)
          return
        }
        if (!response.ok) throw new Error(`Admin data returned ${response.status}`)
        const data = (await response.json()) as DashboardState
        setDashboard(data)
        setAuthenticated(true)
        setLoadError(undefined)
        document.title = `${data.title} · miseshare admin`
      } catch (error) {
        if (!active) return
        setLoadError(
          error instanceof TypeError
            ? 'The dashboard could not reach the server. Check your connection and try again.'
            : 'The dashboard data is temporarily unavailable. Try again shortly.',
        )
      }
    }
    void load()
    const interval = window.setInterval(load, 5_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [retry, search])

  if (authenticated === false) return <AdminLogin pending={false} />
  if (!dashboard && loadError)
    return <AdminUnavailable message={loadError} onRetry={() => setRetry((value) => value + 1)} />
  if (!dashboard) return <AdminLogin pending />
  return (
    <AdminDashboard
      state={dashboard}
      loadError={loadError}
      onRetry={() => setRetry((value) => value + 1)}
    />
  )
}

function AdminLogin({ pending }: { pending: boolean }) {
  return (
    <main className="login-shell">
      <form className="login-card" method="post" action={`${adminBaseUrl}login`}>
        <span className="eyebrow">miseshare operations</span>
        <h1>Admin dashboard</h1>
        <p>
          {pending
            ? 'Checking your admin session…'
            : 'Enter the deployment admin password to inspect room activity.'}
        </p>
        <label htmlFor="admin-password">
          <span>Password</span>
          <Input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <Button variant="unstyled" type="submit">
          Continue
        </Button>
      </form>
    </main>
  )
}

function AdminUnavailable({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="login-shell">
      <section className="login-card" role="alert">
        <span className="eyebrow">miseshare operations</span>
        <h1>Dashboard unavailable</h1>
        <p>{message}</p>
        <Button variant="unstyled" type="button" onClick={onRetry}>
          Try again
        </Button>
      </section>
    </main>
  )
}

function AdminDashboard({
  state,
  loadError,
  onRetry,
}: {
  state: DashboardState
  loadError?: string
  onRetry: () => void
}) {
  const navigation = useMemo(
    () =>
      [
        ['overview', 'Overview', '⌂'],
        ['sessions', 'Sessions', '▣'],
        ['participants', 'Participants', '◎'],
        ['signals', 'Signals', '⇄'],
      ] as const,
    [],
  )

  return (
    <div className="admin-shell" data-admin-root>
      <aside className="sidebar">
        <div className="brand">
          <span>m</span>
          <div>
            <strong>miseshare</strong>
            <small>Admin</small>
          </div>
        </div>
        <nav aria-label="Database models">
          {navigation.map(([view, label, icon]) => (
            <a
              key={view}
              className={view === state.view ? 'active' : undefined}
              href={view === 'overview' ? adminBaseUrl : `${adminBaseUrl}?view=${view}`}
            >
              <i>{icon}</i>
              {label}
            </a>
          ))}
        </nav>
      </aside>
      <section className="admin-main">
        {loadError ? (
          <div className="admin-error-banner" role="alert">
            <span>{loadError} Showing the last successful snapshot.</span>
            <Button variant="unstyled" type="button" onClick={onRetry}>
              Retry now
            </Button>
          </div>
        ) : null}
        <header className="topbar">
          <div>
            <span className="eyebrow">Database</span>
            <h1>{state.title}</h1>
            <p>Updated automatically by React</p>
          </div>
          <div className="actions">
            <form method="post" action={`${adminBaseUrl}logout`}>
              <Button variant="unstyled" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </header>
        <main
          id="admin-content"
          className="dashboard"
          aria-live="polite"
          dangerouslySetInnerHTML={{ __html: state.content }}
        />
      </section>
    </div>
  )
}
