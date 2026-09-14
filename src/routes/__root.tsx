import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from '@tanstack/react-router'
import { MiseshareApp } from '@/routes/-components/miseshare-app'
import '@/shadcn.css'

const description =
  'Create a private browser room for free peer-to-peer screen sharing, group chat, shared audio, and file transfers—no account or install needed.'
const socialDescription =
  'Share screens, chat, audio, and files in a private browser room—free, open source, and without accounts or installs.'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
      { name: 'theme-color', content: '#f5f2eb' },
      { name: 'description', content: description },
      {
        name: 'robots',
        content: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
      },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'miseshare' },
      { property: 'og:locale', content: 'en_US' },
      { property: 'og:title', content: 'miseshare — Free Peer-to-Peer Screen Sharing' },
      { property: 'og:description', content: socialDescription },
      { property: 'og:url', content: 'https://miseshare.vercel.app/' },
      { property: 'og:image', content: 'https://miseshare.vercel.app/social-thumbnail.png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: 'miseshare — Free Peer-to-Peer Screen Sharing' },
      { name: 'twitter:description', content: socialDescription },
      { name: 'twitter:image', content: 'https://miseshare.vercel.app/social-thumbnail.png' },
      { title: 'miseshare — Free Peer-to-Peer Screen Sharing' },
    ],
    links: [
      { rel: 'canonical', href: 'https://miseshare.vercel.app/' },
      { rel: 'icon', href: `${import.meta.env.BASE_URL}favicon.svg`, type: 'image/svg+xml' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@800&display=swap',
      },
      { rel: 'stylesheet', href: `${import.meta.env.BASE_URL}styles.css` },
    ],
  }),
  component: RootApp,
  shellComponent: RootDocument,
})

function RootApp() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  if (pathname.startsWith('/admin')) return <Outlet />
  return (
    <>
      <MiseshareApp />
      <Outlet />
    </>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const screen = /\/room\/[^/]+\/?$/.test(pathname) ? 'room' : 'landing'

  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebApplication',
              name: 'miseshare',
              url: 'https://miseshare.vercel.app/',
              description:
                'Free, open-source peer-to-peer screen sharing, group chat, shared audio, and file transfers in the browser.',
              applicationCategory: 'CommunicationApplication',
              operatingSystem: 'Any',
              isAccessibleForFree: true,
              offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
            }),
          }}
        />
      </head>
      <body data-screen={screen}>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
