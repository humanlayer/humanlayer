// Public exports for the daemon module
// Components should use hooks instead of importing from here directly

export { daemonClient } from './client'
export type { DaemonClient } from './client'

// Export all types
export * from './types'

// Export error types
export * from './errors'
