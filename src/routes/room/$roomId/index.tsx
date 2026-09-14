import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/room/$roomId/')({
  head: () => ({
    meta: [{ name: 'robots', content: 'noindex, nofollow, noarchive' }],
  }),
  component: () => null,
})
