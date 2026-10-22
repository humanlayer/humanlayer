import { useLocalStorage } from '@uidotdev/usehooks'
import { useAuth } from '@workos-inc/authkit-react'

import { scopeManager } from '@/hooks/hotkeys/scopeManager'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useLaunchedSessionsCount } from '@/hooks/live-queries/useLaunchedSessionsCount'
import { useHotkeyHelpStore } from '@/hooks/stores/hotkeyHelpStore'
import { useSessionOnboardingStore } from '@/hooks/stores/sessionOnboardingStore'
import { useMountEffect } from '@/hooks/useMountEffect'
import { HOTKEYS_GUIDE_SHOWN_KEY } from '@/lib/preferences'

const FIRST_SESSION_GUIDE_DELAY_MS = 1500
const MINIMUM_LAUNCHED_SESSIONS = 5

/**
 * Opens the Hotkeys Guide (with its interactive playground) once, on the
 * user's first visit to a session page after they have launched five sessions.
 * It mounts inside SessionDetailProvider after session content has painted and
 * waits a beat more. After that, shift+? reopens it.
 */
export function WiredFirstSessionHotkeysGuide() {
	const { user } = useAuth()
	const launchedSessionsCount = useLaunchedSessionsCount(user?.id)

	if (launchedSessionsCount < MINIMUM_LAUNCHED_SESSIONS) return null

	return <FirstSessionHotkeysGuide />
}

function FirstSessionHotkeysGuide() {
	const [guideShown, setGuideShown] = useLocalStorage<boolean>(HOTKEYS_GUIDE_SHOWN_KEY, false)
	const suppressesPhaseTipForMount = !guideShown

	if (suppressesPhaseTipForMount && !useSessionOnboardingStore.getState().phaseTipSuppressedForMount) {
		useSessionOnboardingStore.getState().suppressPhaseTipForMount()
	}

	useMountEffect(() => {
		if (!suppressesPhaseTipForMount) return

		const onboardingStore = useSessionOnboardingStore.getState()
		onboardingStore.suppressPhaseTipForMount()
		const timeout = setTimeout(() => {
			if (useHotkeyHelpStore.getState().isOpen) return
			// Another overlay owns the keyboard (draft launcher, phase tip, diff
			// review, ...) — don't stack; without setting the flag, the guide will
			// try again on the next session visit.
			const activeScope = scopeManager.getActiveScope()
			if (activeScope !== null && activeScope !== HOTKEY_SCOPES.SESSION_DETAIL) return
			useHotkeyHelpStore.getState().open()
			setGuideShown(true)
		}, FIRST_SESSION_GUIDE_DELAY_MS)
		return () => {
			clearTimeout(timeout)
			useSessionOnboardingStore.getState().reset()
		}
	})

	return null
}
