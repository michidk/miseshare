import { createFileRoute } from '@tanstack/react-router'
import { AdminPage } from './-components/admin-page'

export const Route = createFileRoute('/admin/')({
  head: () => ({
    meta: [
      { title: 'miseshare admin' },
      { name: 'robots', content: 'noindex, nofollow, noarchive' },
    ],
    links: [{ rel: 'stylesheet', href: `${import.meta.env.BASE_URL}admin.css` }],
  }),
  component: AdminPage,
})
