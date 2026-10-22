import { useSessionStorage } from '@uidotdev/usehooks'
import { useCallback } from 'react'

import type { SidebarTab } from '@/components/sidebar-widget/sidebar-tabs'
import { SESSION_SIDEBAR_STATE_KEY_PREFIX } from '@/lib/preferences'

export interface SessionSidebarState {
	currentTab: SidebarTab
	currentArtifactId: string | null
}

const DEFAULT_SESSION_SIDEBAR_STATE: SessionSidebarState = {
	currentTab: 'minimap',
	currentArtifactId: null,
}

export function useSessionSidebarState(sessionId: string) {
	const [storedState, setStoredState] = useSessionStorage<SessionSidebarState | undefined>(
		`${SESSION_SIDEBAR_STATE_KEY_PREFIX}${sessionId}`,
		undefined,
	)
	const state = storedState ?? DEFAULT_SESSION_SIDEBAR_STATE
	const setCurrentTab = useCallback(
		(currentTab: SidebarTab) => setStoredState({ ...state, currentTab }),
		[setStoredState, state],
	)
	const setCurrentArtifactId = useCallback(
		(currentArtifactId: string | null) => setStoredState({ ...state, currentArtifactId }),
		[setStoredState, state],
	)

	return {
		state,
		hasStoredState: storedState !== undefined,
		setState: setStoredState,
		setCurrentTab,
		setCurrentArtifactId,
	}
}
