import { useHotkeysScopeContext } from '@humanlayer/react-hotkeys-hook'
import type React from 'react'
import { useEffect, useRef } from 'react'

import { scopeManager } from '../hooks/hotkeys/scopeManager'
import { HOTKEY_SCOPES, type HotkeyScope } from '../hooks/hotkeys/scopes'

interface HotkeyScopeBoundaryProps {
	scope: HotkeyScope
	isActive?: boolean // For modals/conditionally visible components
	rootScopeDisabled?: boolean
	/** Stable list of enclosing scopes to disable even when a sibling's activation is not in the provider snapshot yet. */
	shadowScopes?: readonly HotkeyScope[]
	componentName?: string // For debugging
	children: React.ReactNode
}

export function HotkeyScopeBoundary({
	scope,
	isActive = true,
	rootScopeDisabled = false,
	shadowScopes,
	componentName,
	children,
}: HotkeyScopeBoundaryProps) {
	const { enableScope, disableScope, activeScopes } = useHotkeysScopeContext()
	const entryIdRef = useRef<string | undefined>(undefined)
	const previousScopesRef = useRef<string[]>([])
	const hasCleanedUpRef = useRef(false)

	useEffect(() => {
		if (!isActive) {
			return
		}

		// Reset cleanup flag
		hasCleanedUpRef.current = false

		// Generate unique ID for this boundary instance
		const mountId = crypto.randomUUID()
		entryIdRef.current = mountId

		// Push to stack
		scopeManager.push({
			id: mountId,
			scope,
			rootDisabled: rootScopeDisabled,
			shadowScopes,
			timestamp: Date.now(),
			component: componentName,
		})

		// Capture current active scopes before we change them
		const currentActive = [...activeScopes]
		previousScopesRef.current = currentActive

		// SIMPLIFIED APPROACH:
		// 1. Disable only the currently active scopes (except global)
		// 2. Enable our scope
		// 3. Enable root if not disabled

		// Step 1: Disable currently active scopes except wildcard
		currentActive.forEach((s) => {
			// Never try to disable the wildcard scope '*'
			if (s === '*') {
				return
			}
			if (s === HOTKEY_SCOPES.ROOT && !rootScopeDisabled) {
				// Keep root enabled if this boundary doesn't disable it
				return
			}
			disableScope(s)
		})

		// Step 2: Enable our scope
		shadowScopes?.forEach(disableScope)
		enableScope(scope)

		// Step 3: Ensure root is enabled if not disabled
		if (!rootScopeDisabled) {
			enableScope(HOTKEY_SCOPES.ROOT)
		}

		// Cleanup
		return () => {
			// Prevent double cleanup in StrictMode
			if (hasCleanedUpRef.current) {
				return
			}
			hasCleanedUpRef.current = true

			const cleanupId = entryIdRef.current

			// Use setTimeout to handle React's unmount order
			setTimeout(() => {
				// Remove from stack
				if (cleanupId) {
					scopeManager.remove(cleanupId)
				}

				// Disable our scope
				disableScope(scope)

				// Find what should be active now
				const stack = scopeManager.getStack()

				const newTop = stack.at(-1)

				if (newTop !== undefined) {
					// Deferred cleanup must respect the surviving boundary's explicit shadows too.
					newTop.shadowScopes?.forEach(disableScope)
					// Enable the new top scope
					enableScope(newTop.scope)

					// Enable root if not disabled by new top
					if (!newTop.rootDisabled) {
						enableScope(HOTKEY_SCOPES.ROOT)
					}
				} else {
					// Stack empty, restore to initial state
					enableScope(HOTKEY_SCOPES.ROOT)
				}
			}, 0)
		}
	}, [isActive, scope, rootScopeDisabled, shadowScopes, componentName, enableScope, disableScope])
	// Note: activeScopes intentionally captured at mount time only

	return children
}
