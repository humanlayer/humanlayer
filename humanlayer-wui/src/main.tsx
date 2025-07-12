import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { ThemeProvider } from './contexts/ThemeContext'
import { ZoomProvider } from './contexts/ZoomContext'
import { HotkeysProvider } from 'react-hotkeys-hook'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <ZoomProvider>
        <HotkeysProvider initiallyActiveScopes={['none']}>
          <RouterProvider router={router} />
        </HotkeysProvider>
      </ZoomProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
