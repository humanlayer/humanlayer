import { error, warn, info, debug, trace } from '@tauri-apps/plugin-log'

// Create a logging service that preserves console functionality
// while also sending to Tauri's log plugin
export const logger = {
  log: (message: string, ...args: any[]) => {
    const fullMessage = [message, ...args]
      .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ')
    info(`[Console] ${fullMessage}`)
    // Also log to browser console in dev mode
    if (import.meta.env.DEV) {
      console.log(message, ...args)
    }
  },

  error: (message: string, ...args: any[]) => {
    const fullMessage = [message, ...args]
      .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ')
    error(`[Console] ${fullMessage}`)
    if (import.meta.env.DEV) {
      console.error(message, ...args)
    }
  },

  warn: (message: string, ...args: any[]) => {
    const fullMessage = [message, ...args]
      .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ')
    warn(`[Console] ${fullMessage}`)
    if (import.meta.env.DEV) {
      console.warn(message, ...args)
    }
  },

  debug: (message: string, ...args: any[]) => {
    const fullMessage = [message, ...args]
      .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ')
    debug(`[Console] ${fullMessage}`)
    if (import.meta.env.DEV) {
      console.debug(message, ...args)
    }
  },

  trace: (message: string, ...args: any[]) => {
    const fullMessage = [message, ...args]
      .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ')
    trace(`[Console] ${fullMessage}`)
    if (import.meta.env.DEV) {
      console.trace(message, ...args)
    }
  },
}

// Export original console methods for migration
export const browserConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  debug: console.debug.bind(console),
  trace: console.trace.bind(console),
}
