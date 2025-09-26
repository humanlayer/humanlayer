import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { ThemeProvider } from './contexts/ThemeContext'
import { HotkeysProvider } from 'react-hotkeys-hook'
import { attachConsole } from '@tauri-apps/plugin-log'
import { initializeSentry } from '@/lib/telemetry/sentry'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { HotkeyScopeDebugger } from './components/HotkeyScopeDebugger'

// Initialize console logging bridge to display Tauri logs in browser console
// Note: This does NOT capture frontend console.* calls - it only shows Rust logs in the browser
attachConsole().catch(console.error)

// Initialize Sentry as early as possible, but consent will be checked at send time
initializeSentry().catch(console.error)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <HotkeysProvider initiallyActiveScopes={['*', '.']}>
          <RouterProvider router={router} />
          <HotkeyScopeDebugger />
        </HotkeysProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
