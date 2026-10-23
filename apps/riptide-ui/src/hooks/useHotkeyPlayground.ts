import {
	initialPlaygroundState,
	type PlaygroundState,
	playgroundActionForKeyEvent,
	playgroundConsumesEscape,
	playgroundReducer,
} from '@humanlayer/ui/components/hotkey-playground'
import { useCallback, useLayoutEffect, useReducer, useRef } from 'react'

import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { useMountEffect } from '@/hooks/useMountEffect'

const PLAYGROUND_KEYS = 'j,k,h,l,s,r,enter,down,up,left,right,shift+h,shift+l,shift+s,shift+left,shift+right'

/**
 * Drives the Hotkeys Guide playground. Movement keys register under the
 * HOTKEY_HELP scope, which the guide's HotkeyScopeBoundary activates with
 * rootScopeDisabled — so they're inert while the guide is closed and exclusive
 * while it's open; nothing reaches the app's own j/k/h/l handlers.
 *
 * Escape is special. Radix's DismissableLayer listens for Escape on `document`
 * in the capture phase and closes the dialog unless `event.defaultPrevented`.
 * Rather than rely on Radix invoking our `onEscapeKeyDown` (a prop-forwarding +
 * timing dependency that proved flaky at tutorial step 4), we intercept Escape
 * ourselves with a capture-phase listener on `window`. `window` is an ancestor
 * of `document`, so our listener fires first. We only swallow Escape while the
 * fake session input is focused (`playgroundConsumesEscape`) — there we
 * `stopImmediatePropagation()` so Radix's handler never runs and the keypress
 * just blurs the input. Everywhere else we do nothing and let Escape fall
 * through to close the guide as usual.
 */
export function useHotkeyPlayground({ open = false, enabled = true }: { open?: boolean; enabled?: boolean } = {}): {
	state: PlaygroundState
	reset: () => void
} {
	const [state, dispatch] = useReducer(playgroundReducer, initialPlaygroundState)
	const latestRef = useRef({ open, enabled, state })

	useLayoutEffect(() => {
		latestRef.current = { open, enabled, state }
	}, [open, enabled, state])

	useAppHotkeys(
		PLAYGROUND_KEYS,
		(event) => {
			const action = playgroundActionForKeyEvent(event)
			if (!action) return
			event.preventDefault()
			dispatch(action)
		},
		{ scopes: [HOTKEY_SCOPES.HOTKEY_HELP], enableOnFormTags: false, enabled },
	)

	useMountEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			const { open: latestOpen, enabled: latestEnabled, state: latestState } = latestRef.current
			if (!latestOpen || !latestEnabled) return
			// Only the fake input traps Escape; otherwise let it close the guide.
			if (!playgroundConsumesEscape(latestState)) return
			// Beat Radix's document-level capture handler entirely.
			event.preventDefault()
			event.stopImmediatePropagation()
			dispatch({ type: 'escape' })
		}

		window.addEventListener('keydown', onKeyDown, { capture: true })
		return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
	})

	const reset = useCallback(() => {
		dispatch({ type: 'reset' })
	}, [])

	return { state, reset }
}
