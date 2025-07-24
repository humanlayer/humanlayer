import { HTTPDaemonClient } from './http-client';

// Replace the Tauri-based implementation
export const daemonClient = new HTTPDaemonClient();

// Export the type for use in components
export type { DaemonClient } from './types';
