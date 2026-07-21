import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/stockr/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'logo.svg'],
      manifest: {
        name: 'Stockr',
        short_name: 'Stockr',
        description: 'Gestion de depot & calculateur electrique',
        theme_color: '#C2703D',
        background_color: '#FAF7F2',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/stockr/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: '/stockr/index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/ytbrwsngmlzolnqyiaib\.supabase\.co\/rest\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'supabase-data-cache', expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 7 }, networkTimeoutSeconds: 4 }
          },
          {
            urlPattern: /^https:\/\/ytbrwsngmlzolnqyiaib\.supabase\.co\/storage\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'supabase-images-cache', expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 } }
          }
        ]
      }
    })
  ]
})
