import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon-64.png', 'og.png'],
      manifest: {
        name: 'StepByStep by Nadine and Victor',
        short_name: 'StepByStep',
        description: 'Build habits together and turn steady progress into meaningful rewards.',
        theme_color: '#F1F2F6',
        background_color: '#F1F2F6',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '.',
        start_url: '.',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,ico,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [],
      },
    }),
    {
      name: 'step-by-step-social-metadata',
      transformIndexHtml(html) {
        const siteUrl = process.env.VITE_SITE_URL?.replace(/\/$/, '')
        if (!siteUrl) return html
        return html.replace('</head>', `    <meta property="og:title" content="StepByStep by Nadine and Victor" />\n    <meta property="og:description" content="Small steps, shared joy. Build habits together and turn progress into meaningful rewards." />\n    <meta property="og:type" content="website" />\n    <meta property="og:url" content="${siteUrl}" />\n    <meta property="og:image" content="${siteUrl}/og.png" />\n    <meta name="twitter:card" content="summary_large_image" />\n    <meta name="twitter:title" content="StepByStep by Nadine and Victor" />\n    <meta name="twitter:description" content="Small steps, shared joy." />\n    <meta name="twitter:image" content="${siteUrl}/og.png" />\n  </head>`)
      },
    },
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
