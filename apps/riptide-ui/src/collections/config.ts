// App-specific env var
export const VITE_PUBLIC_SYNC_ORIGIN = import.meta.env.VITE_PUBLIC_SYNC_ORIGIN
if (!VITE_PUBLIC_SYNC_ORIGIN) throw new Error('Missing VITE_PUBLIC_SYNC_ORIGIN')
