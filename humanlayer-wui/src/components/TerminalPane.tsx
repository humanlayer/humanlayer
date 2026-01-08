import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal, ITheme } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import 'xterm/css/xterm.css'

import { getDaemonUrl } from '@/lib/daemon/http-config'
import { logger } from '@/lib/logging'
import { useTheme } from '@/contexts/ThemeContext'

interface TerminalPaneProps {
  sessionId: string
  className?: string
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

/**
 * Get terminal theme from CSS custom properties
 * Uses the --terminal-* CSS variables defined in App.css themes
 */
function getTerminalTheme(): ITheme {
  const computedStyle = getComputedStyle(document.documentElement)
  const getColor = (varName: string, fallback: string) => {
    const value = computedStyle.getPropertyValue(varName).trim()
    return value || fallback
  }

  return {
    // Core colors from theme
    background: getColor('--terminal-bg', '#0a0a0a'),
    foreground: getColor('--terminal-fg', '#fafafa'),
    cursor: getColor('--terminal-accent', '#22c55e'),
    cursorAccent: getColor('--terminal-bg', '#0a0a0a'),
    selectionBackground: getColor('--terminal-selection', 'rgba(255, 255, 255, 0.2)'),

    // Standard ANSI colors (0-7) from theme
    black: getColor('--terminal-color-0', '#000000'),
    red: getColor('--terminal-color-1', '#ef4444'),
    green: getColor('--terminal-color-2', '#22c55e'),
    yellow: getColor('--terminal-color-3', '#eab308'),
    blue: getColor('--terminal-color-4', '#3b82f6'),
    magenta: getColor('--terminal-color-5', '#a855f7'),
    cyan: getColor('--terminal-color-6', '#06b6d4'),
    white: getColor('--terminal-color-7', '#f5f5f5'),

    // Bright ANSI colors (8-15) from theme
    brightBlack: getColor('--terminal-color-8', '#737373'),
    brightRed: getColor('--terminal-color-9', '#f87171'),
    brightGreen: getColor('--terminal-color-10', '#4ade80'),
    brightYellow: getColor('--terminal-color-11', '#facc15'),
    brightBlue: getColor('--terminal-color-12', '#60a5fa'),
    brightMagenta: getColor('--terminal-color-13', '#c084fc'),
    brightCyan: getColor('--terminal-color-14', '#22d3ee'),
    brightWhite: getColor('--terminal-color-15', '#ffffff'),
  }
}

/**
 * TerminalPane - Interactive terminal component using xterm.js
 * Connects to the daemon's WebSocket terminal endpoint to provide
 * a shell session scoped to the session's working directory.
 */
export function TerminalPane({ sessionId, className = '' }: TerminalPaneProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const terminalInstanceRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const onDataDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Get current theme from context
  const { theme } = useTheme()

  // Send resize message to server
  const sendResize = useCallback(() => {
    const terminal = terminalInstanceRef.current
    const ws = wsRef.current

    if (terminal && ws && ws.readyState === WebSocket.OPEN) {
      const resizeMessage = JSON.stringify({
        type: 'resize',
        cols: terminal.cols,
        rows: terminal.rows,
      })
      ws.send(resizeMessage)
    }
  }, [])

  // Handle window resize
  const handleResize = useCallback(() => {
    const fitAddon = fitAddonRef.current

    if (fitAddon) {
      try {
        fitAddon.fit()
        sendResize()
      } catch (e) {
        // Ignore fit errors when terminal is not visible
        logger.debug('Terminal fit error (likely not visible):', e)
      }
    }
  }, [sendResize])

  // Initialize terminal and WebSocket
  useEffect(() => {
    if (!terminalRef.current || !sessionId) {
      return
    }

    // Create terminal with theme from CSS variables
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      theme: getTerminalTheme(),
      allowProposedApi: true,
    })

    terminalInstanceRef.current = terminal

    // Add fit addon
    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    terminal.loadAddon(fitAddon)

    // Add web links addon
    const webLinksAddon = new WebLinksAddon()
    terminal.loadAddon(webLinksAddon)

    // Open terminal in the container
    terminal.open(terminalRef.current)

    // Initial fit
    setTimeout(() => {
      fitAddon.fit()
    }, 0)

    // Connect to WebSocket
    const connect = async () => {
      try {
        setStatus('connecting')
        setErrorMessage(null)

        const baseUrl = await getDaemonUrl()
        // Convert http:// to ws:// or https:// to wss://
        const wsUrl = baseUrl.replace(/^http/, 'ws')
        const url = `${wsUrl}/api/v1/terminal?sessionId=${encodeURIComponent(sessionId)}`

        logger.log('Connecting to terminal WebSocket:', url)

        const ws = new WebSocket(url)
        ws.binaryType = 'arraybuffer'
        wsRef.current = ws

        ws.onopen = () => {
          logger.log('Terminal WebSocket connected')
          setStatus('connected')

          // Send initial resize
          sendResize()
        }

        ws.onmessage = event => {
          if (event.data instanceof ArrayBuffer) {
            // Binary data from PTY
            const data = new Uint8Array(event.data)
            terminal.write(data)
          } else if (typeof event.data === 'string') {
            // Text message (shouldn't happen with our protocol, but handle it)
            terminal.write(event.data)
          }
        }

        ws.onerror = event => {
          logger.error('Terminal WebSocket error:', event)
          setStatus('error')
          setErrorMessage('Connection error')
        }

        ws.onclose = event => {
          logger.log('Terminal WebSocket closed:', event.code, event.reason)
          setStatus('disconnected')
          wsRef.current = null

          // Show disconnection message in terminal
          terminal.write('\r\n\x1b[33m[Terminal disconnected]\x1b[0m\r\n')
        }

        // Dispose of any existing onData listener before adding a new one
        if (onDataDisposableRef.current) {
          onDataDisposableRef.current.dispose()
        }

        // Forward terminal input to WebSocket
        onDataDisposableRef.current = terminal.onData(data => {
          if (ws.readyState === WebSocket.OPEN) {
            // Send as binary
            const encoder = new TextEncoder()
            ws.send(encoder.encode(data))
          }
        })
      } catch (error) {
        logger.error('Failed to connect to terminal:', error)
        setStatus('error')
        setErrorMessage(error instanceof Error ? error.message : 'Failed to connect')
      }
    }

    connect()

    // Set up resize observer
    const resizeObserver = new ResizeObserver(() => {
      handleResize()
    })
    resizeObserver.observe(terminalRef.current)

    // Also listen to window resize
    window.addEventListener('resize', handleResize)

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()

      // Dispose of onData listener
      if (onDataDisposableRef.current) {
        onDataDisposableRef.current.dispose()
        onDataDisposableRef.current = null
      }

      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }

      if (terminalInstanceRef.current) {
        terminalInstanceRef.current.dispose()
        terminalInstanceRef.current = null
      }

      fitAddonRef.current = null
    }
  }, [sessionId, handleResize, sendResize])

  // Update terminal theme when app theme changes
  useEffect(() => {
    const terminal = terminalInstanceRef.current
    if (!terminal) return

    // Small delay to ensure CSS variables are updated
    const timeoutId = setTimeout(() => {
      terminal.options.theme = getTerminalTheme()
    }, 20)

    return () => clearTimeout(timeoutId)
  }, [theme])

  // Reconnect handler
  const handleReconnect = useCallback(async () => {
    if (wsRef.current) {
      wsRef.current.close()
    }

    // Clear terminal
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.clear()
      terminalInstanceRef.current.write('\x1b[33m[Reconnecting...]\x1b[0m\r\n')
    }

    // Re-run the connection logic by re-mounting
    // This is handled by React re-render when status changes
    setStatus('connecting')

    try {
      const baseUrl = await getDaemonUrl()
      const wsUrl = baseUrl.replace(/^http/, 'ws')
      const url = `${wsUrl}/api/v1/terminal?sessionId=${encodeURIComponent(sessionId)}`

      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onopen = () => {
        setStatus('connected')
        sendResize()
        if (terminalInstanceRef.current) {
          terminalInstanceRef.current.write('\x1b[32m[Connected]\x1b[0m\r\n')
        }
      }

      ws.onmessage = event => {
        if (event.data instanceof ArrayBuffer && terminalInstanceRef.current) {
          const data = new Uint8Array(event.data)
          terminalInstanceRef.current.write(data)
        }
      }

      ws.onerror = () => {
        setStatus('error')
        setErrorMessage('Connection error')
      }

      ws.onclose = () => {
        setStatus('disconnected')
        wsRef.current = null
        if (terminalInstanceRef.current) {
          terminalInstanceRef.current.write('\r\n\x1b[33m[Terminal disconnected]\x1b[0m\r\n')
        }
      }

      // Dispose of any existing onData listener before adding a new one
      if (onDataDisposableRef.current) {
        onDataDisposableRef.current.dispose()
      }

      if (terminalInstanceRef.current) {
        onDataDisposableRef.current = terminalInstanceRef.current.onData(data => {
          if (ws.readyState === WebSocket.OPEN) {
            const encoder = new TextEncoder()
            ws.send(encoder.encode(data))
          }
        })
      }
    } catch (error) {
      setStatus('error')
      setErrorMessage(error instanceof Error ? error.message : 'Failed to reconnect')
    }
  }, [sessionId, sendResize])

  return (
    <div className={`relative flex flex-col h-full ${className}`}>
      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-secondary/30">
        <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          <span>Terminal</span>
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              status === 'connected'
                ? 'bg-[--terminal-success]'
                : status === 'connecting'
                  ? 'bg-yellow-500 animate-pulse'
                  : 'bg-[--terminal-error]'
            }`}
          />
          <span className="text-[10px]">
            {status === 'connected' && 'Connected'}
            {status === 'connecting' && 'Connecting...'}
            {status === 'disconnected' && 'Disconnected'}
            {status === 'error' && (errorMessage || 'Error')}
          </span>
        </div>
        {(status === 'disconnected' || status === 'error') && (
          <button
            onClick={handleReconnect}
            className="px-2 py-0.5 text-xs font-mono border border-border bg-background text-foreground hover:bg-accent/10 transition-colors"
          >
            Reconnect
          </button>
        )}
      </div>

      {/* Terminal container */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-hidden bg-background"
        style={{ minHeight: 0 }}
      />
    </div>
  )
}

export default TerminalPane
