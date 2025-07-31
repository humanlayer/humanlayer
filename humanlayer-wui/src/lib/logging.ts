// Detect if we're in a test environment (no window object)
const isTestEnvironment = typeof window === 'undefined'

// Lazy load Tauri logging to avoid import errors in tests
let tauriLog: any = null
const getTauriLog = async () => {
  if (!tauriLog && !isTestEnvironment) {
    tauriLog = await import('@tauri-apps/plugin-log')
  }
  return tauriLog
}

// Create a logging service that preserves console functionality
// while also sending to Tauri's log plugin
export const logger = {
  log: (message: string, ...args: any[]) => {
    const fullMessage = [message, ...args]
      .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ')

    // In test environment, preserve original arguments
    if (isTestEnvironment) {
      console.log(message, ...args)
      return
    }

    getTauriLog().then(log => log?.info?.(`[Console] ${fullMessage}`))
    // Also log to browser console in dev mode
    if (import.meta.env.DEV) {
      console.log(message, ...args)
    }
  },

  error: (message: string, ...args: any[]) => {
    const fullMessage = [message, ...args]
      .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ')

    if (isTestEnvironment) {
      // In tests, preserve original arguments for test assertions
      console.error(message, ...args)
      return
    }

    getTauriLog().then(log => log?.error?.(`[Console] ${fullMessage}`))
    if (import.meta.env.DEV) {
      console.error(message, ...args)
    }
  },

  warn: (message: string, ...args: any[]) => {
    const fullMessage = [message, ...args]
      .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ')

    if (isTestEnvironment) {
      console.warn(message, ...args)
      return
    }

    getTauriLog().then(log => log?.warn?.(`[Console] ${fullMessage}`))
    if (import.meta.env.DEV) {
      console.warn(message, ...args)
    }
  },

  debug: (message: string, ...args: any[]) => {
    const fullMessage = [message, ...args]
      .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ')

    if (isTestEnvironment) {
      console.debug(message, ...args)
      return
    }

    getTauriLog().then(log => log?.debug?.(`[Console] ${fullMessage}`))
    if (import.meta.env.DEV) {
      console.debug(message, ...args)
    }
  },

  trace: (message: string, ...args: any[]) => {
    const fullMessage = [message, ...args]
      .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ')

    if (isTestEnvironment) {
      console.trace(message, ...args)
      return
    }

    getTauriLog().then(log => log?.trace?.(`[Console] ${fullMessage}`))
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
