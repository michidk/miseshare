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

  useEffect(() => {
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
          return
        }
        if (!response.ok) throw new Error(`Admin data returned ${response.status}`)
        const data = (await response.json()) as DashboardState
        setDashboard(data)
        setAuthenticated(true)
        document.title = `${data.title} · miseshare admin`
      } catch {
        if (active) setAuthenticated(false)
      }
    }
    void load()
    const interval = window.setInterval(load, 5_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [search])

  if (authenticated !== true || !dashboard)
    return <AdminLogin pending={authenticated === undefined} />
  return <AdminDashboard state={dashboard} />
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

function AdminDashboard({ state }: { state: DashboardState }) {
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
