import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ThemeProvider } from './contexts/ThemeContext'
import { HotkeysProvider } from 'react-hotkeys-hook'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <HotkeysProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </HotkeysProvider>
  </React.StrictMode>,
)
