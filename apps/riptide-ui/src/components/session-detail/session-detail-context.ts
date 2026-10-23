import { createContext, use } from 'react'

import type { SessionDetailContextValue } from './SessionDetailProvider'

export const SessionDetailContext = createContext<SessionDetailContextValue | null>(null)

export function useSessionDetail(): SessionDetailContextValue {
	const context = use(SessionDetailContext)
	if (!context) throw new Error('useSessionDetail must be used within a SessionDetailProvider')
	return context
}
