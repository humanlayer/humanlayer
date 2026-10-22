import { useHotkeysScopeContext } from '@humanlayer/react-hotkeys-hook'
import type React from 'react'
import { useEffect, useRef } from 'react'

import { scopeManager } from '@/hooks/hotkeys/scopeManager'
import { HOTKEY_SCOPES, type HotkeyScope } from '@/hooks/hotkeys/scopes'

interface HotkeyScopeBoundaryProps {
	scope: HotkeyScope
	isActive?: boolean
	rootScopeDisabled?: boolean
	componentName?: string
	children: React.ReactNode
}

export function HotkeyScopeBoundary({
	scope,
	isActive = true,
	rootScopeDisabled = false,
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

		hasCleanedUpRef.current = false
		const mountId = crypto.randomUUID()
		entryIdRef.current = mountId

		scopeManager.push({
			id: mountId,
			scope,
			rootDisabled: rootScopeDisabled,
			timestamp: Date.now(),
			component: componentName,
		})

		const currentActive = Array.from(activeScopes ?? [])
		previousScopesRef.current = currentActive

		currentActive.forEach((s) => {
			if (s === '*') return
			if (s === HOTKEY_SCOPES.ROOT && !rootScopeDisabled) return
			disableScope(s)
		})

		enableScope(scope)

		if (!rootScopeDisabled) {
			enableScope(HOTKEY_SCOPES.ROOT)
		}

		return () => {
			if (hasCleanedUpRef.current) return
			hasCleanedUpRef.current = true

			const cleanupId = entryIdRef.current

			setTimeout(() => {
				if (cleanupId) {
					scopeManager.remove(cleanupId)
				}

				disableScope(scope)

				const stack = scopeManager.getStack()

				if (stack.length > 0) {
					const newTop = stack[stack.length - 1]
					if (newTop === undefined) return
					enableScope(newTop.scope)
					if (!newTop.rootDisabled) {
						enableScope(HOTKEY_SCOPES.ROOT)
					}
				} else {
					enableScope(HOTKEY_SCOPES.ROOT)
				}
			}, 0)
		}
	}, [isActive, scope, rootScopeDisabled, componentName, enableScope, disableScope])

	return <>{children}</>
}
