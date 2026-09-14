import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  const basePath = normalizeBasePath(process.env.BASE_PATH)

  return {
    base: basePath || '/',
    server: { allowedHosts: true },
    preview: { allowedHosts: true },
    resolve: {
      alias: { '@': resolve('src') },
      tsconfigPaths: true,
      dedupe: ['react', 'react-dom'],
    },
    plugins: [
      tailwindcss(),
      tanstackStart({
        router: {
          basepath: basePath || '/',
        },
      }),
      nitro({
        preset: process.env.VERCEL ? 'vercel' : 'bun',
        routeRules: {
          '/assets/**': {
            headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
          },
          '/admin.css': { headers: { 'Cache-Control': 'public, max-age=0' } },
          '/favicon.svg': { headers: { 'Cache-Control': 'public, max-age=0' } },
          '/robots.txt': { headers: { 'Cache-Control': 'public, max-age=0' } },
          '/sitemap.xml': { headers: { 'Cache-Control': 'public, max-age=0' } },
          '/social-thumbnail.png': {
            headers: { 'Cache-Control': 'public, max-age=0' },
          },
          '/styles.css': { headers: { 'Cache-Control': 'public, max-age=0' } },
        },
        routes: {
          '/api/rooms': './src/lib/server/room-handler.server.ts',
          '/api/rooms/**': './src/lib/server/room-handler.server.ts',
          '/health': './src/lib/server/health-handler.server.ts',
          '/health/**': './src/lib/server/health-handler.server.ts',
          '/config': './src/lib/server/config-handler.server.ts',
          '/emotes': './src/lib/server/emotes-handler.server.ts',
          '/emotes/**': './src/lib/server/emotes-handler.server.ts',
          '/admin/data': './src/lib/server/admin-handler.server.ts',
          '/admin/login': './src/lib/server/admin-handler.server.ts',
          '/admin/logout': './src/lib/server/admin-handler.server.ts',
        },
      }),
      viteReact(),
    ],
  }
})

function normalizeBasePath(value = '') {
  const normalized = value.trim().replace(/^\/*|\/*$/g, '')
  return normalized ? `/${normalized}` : ''
}
