/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Prompt, not autoUpdate: autoUpdate implies skipWaiting + clientsClaim,
      // so a deploy swaps hashed chunks under a page that is already running.
      // Mid-shop, offline, with a queue of unsent mutations is exactly when
      // that must not happen — UpdatePrompt lets the user pick the moment.
      registerType: 'prompt',
      // Registration lives in UpdatePrompt (useRegisterSW), so nothing should
      // be injected into index.html.
      injectRegister: null,
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        id: '/',
        name: 'AisleFlow',
        short_name: 'AisleFlow',
        description: 'Shared grocery list',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#1976d2',
        background_color: '#ffffff',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          // Belt-and-braces: the persisted query cache is the primary
          // offline data source; this covers a cold SW-served load. Matches
          // GET /api/lists and each list's GET /api/lists/{id}/items.
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              (url.pathname === '/api/lists' ||
                /^\/api\/lists\/[^/]+\/items$/.test(url.pathname)),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-items',
              networkTimeoutSeconds: 3,
              // Room for the lists response plus several lists' items.
              expiration: { maxEntries: 16 },
            },
          },
        ],
      },
      // The SW is exercised against the prod build; dev stays SW-free.
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5174,
    allowedHosts: ['aisle-flow.duckdns.org'],
    proxy: {
      '/api': 'http://localhost:8081',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    // e2e/ is Playwright's (`make e2e`); vitest must not try to collect it.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
