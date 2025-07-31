import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { ThemeProvider } from './contexts/ThemeContext'
import { HotkeysProvider } from 'react-hotkeys-hook'
import { attachConsole } from '@tauri-apps/plugin-log'

// Initialize console logging bridge to display Tauri logs in browser console
// Note: This does NOT capture frontend console.* calls - it only shows Rust logs in the browser
attachConsole().catch(console.error)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <HotkeysProvider initiallyActiveScopes={['none']}>
        <RouterProvider router={router} />
      </HotkeysProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
