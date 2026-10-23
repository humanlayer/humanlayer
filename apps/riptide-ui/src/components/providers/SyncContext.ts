import { createContext } from 'react'

import type { SyncContextValue, SyncInternalContextValue } from './SyncProvider'

export const SyncContext = createContext<SyncContextValue | null>(null)
export const SyncInternalContext = createContext<SyncInternalContextValue | null>(null)
