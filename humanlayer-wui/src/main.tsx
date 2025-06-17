import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { ThemeProvider } from './contexts/ThemeContext'
import { HotkeysProvider } from 'react-hotkeys-hook'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <HotkeysProvider>
        <RouterProvider router={router} />
      </HotkeysProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
