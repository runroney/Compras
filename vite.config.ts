import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Compras',
        short_name: 'Compras',
        description: 'Lista de compras do mercado, sincronizada e offline',
        lang: 'pt-BR',
        theme_color: '#1e7f5c',
        background_color: '#f6f8f6',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: 'index.html', globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], globIgnores: ['tesseract/**'],
        // O leitor de cupom (arquivos grandes) fica guardado no aparelho depois do primeiro uso, para funcionar sem internet.
        runtimeCaching: [{ urlPattern: ({ url }) => url.pathname.includes('/tesseract/'), handler: 'CacheFirst', options: { cacheName: 'ocr', expiration: { maxEntries: 10 } } }],
      },
    }),
  ],
})
