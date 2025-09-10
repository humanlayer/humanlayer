import path from 'path'
import { defineConfig, PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'

const host = process.env.TAURI_DEV_HOST
const port = process.env.VITE_PORT ? parseInt(process.env.VITE_PORT) : 1420
const hmrPort = port + 1

// Determine if this is a Sentry-enabled build (has SENTRY_ORG configured)
const isSentryRelease = !!process.env.SENTRY_ORG && process.env.NODE_ENV === 'production'

/* React Dev Tools */
// https://eikowagenknecht.de/posts/using-react-devtools-with-tauri-v2-and-vite/
// https://react.dev/learn/react-developer-tools
// npm i -g react-devtools and then launch `react-devtools` in a terminal while your Tauri app is running
const reactDevTools = (): PluginOption => {
  return {
    name: 'react-devtools',
    apply: 'serve', // Only apply this plugin during development
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'script',
            attrs: {
              src: 'http://localhost:8097',
            },
            injectTo: 'head',
          },
        ],
      }
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    reactDevTools(),
    tailwindcss(),
    
    // Sentry plugin only for builds with proper configuration
    ...(isSentryRelease
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG!,
            project: process.env.SENTRY_PROJECT!,
            authToken: process.env.SENTRY_AUTH_TOKEN!,

            release: {
              name: process.env.VITE_APP_VERSION || process.env.npm_package_version || 'unknown',
              uploadLegacySourcemaps: {
                paths: ['dist'],
              },
            },

            sourcemaps: {
              // Security: Remove source maps after upload so they don't get bundled
              filesToDeleteAfterUpload: ['**/*.js.map', '**/*.mjs.map'],
            },
          }),
        ]
      : []),
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // Generate source maps for production builds (required for Sentry)
  build: {
    sourcemap: process.env.NODE_ENV === 'production',
    // Additional build optimizations
    rollupOptions: {
      output: {
        // Don't include source code in source maps (security)
        sourcemapExcludeSources: true,
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: port,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: hmrPort,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**', '**/*.test.ts'],
    },
  },
}))
