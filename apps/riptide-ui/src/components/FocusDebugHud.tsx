import { useHotkeysContext } from '@humanlayer/react-hotkeys-hook'
import { useSyncExternalStore } from 'react'

import { editableHasDomFocus } from '@/hooks/hotkeys/editable-focus'
import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'
import { useFocusStore } from '@/hooks/stores/focusStore'

function subscribeDomState(onStoreChange: () => void): () => void {
	const update = () => {
		onStoreChange()
	}
	document.addEventListener('focusin', update, true)
	document.addEventListener('focusout', update, true)
	window.addEventListener('popstate', update)
	window.addEventListener('storage', update)
	const observer = new MutationObserver(update)
	observer.observe(document.documentElement, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ['data-focus-debug-artifact-instance', 'data-focus-debug-navigation-enabled'],
	})
	queueMicrotask(update)
	return () => {
		document.removeEventListener('focusin', update, true)
		document.removeEventListener('focusout', update, true)
		window.removeEventListener('popstate', update)
		window.removeEventListener('storage', update)
		observer.disconnect()
	}
}

function focusDebugEnabled(): boolean {
	if (!import.meta.env.DEV) return false
	const queryEnabled = new URLSearchParams(window.location.search).get('focusDebug') === '1'
	const stored = window.localStorage.getItem('focusDebug')
	return queryEnabled || stored === '1' || stored === 'true'
}

function activeElementLabel(): string {
	const active = document.activeElement
	if (!(active instanceof HTMLElement)) return 'none'
	const className = typeof active.className === 'string' ? active.className.trim().replace(/\s+/g, '.') : ''
	return `${active.tagName.toLowerCase()}${className ? `.${className.slice(0, 64)}` : ''}`
}

function artifactNavigationInstances(): string {
	const instances = [...document.querySelectorAll<HTMLElement>('[data-focus-debug-artifact-instance]')]
	return instances.length === 0
		? 'none'
		: instances
				.map(
					(node) =>
						`${node.dataset.focusDebugArtifactInstance}:${node.dataset.focusDebugNavigationEnabled === 'true' ? 'on' : 'off'}`,
				)
				.join(', ')
}

function domDebugSnapshot(): string {
	return `${activeElementLabel()}\n${String(editableHasDomFocus())}\n${artifactNavigationInstances()}`
}

export function FocusDebugHud() {
	const [activeElement, editable, artifactNavigation] = useSyncExternalStore(
		subscribeDomState,
		domDebugSnapshot,
		() => 'none\nfalse\nnone',
	).split('\n')
	const focusedArea = useFocusStore((state) => state.focusedArea)
	const lastHotkey = useFocusStore((state) => state.lastHotkeyDebug)
	const sidebarViewerMounted = useArtifactViewerStore((state) => state.isSidebarViewerMounted)
	const { activeScopes } = useHotkeysContext()

	if (!focusDebugEnabled()) return null

	return (
		<aside
			data-focus-debug-hud
			className="pointer-events-none fixed bottom-2 right-2 z-[10000] max-w-[min(36rem,calc(100vw-1rem))] bg-black/90 px-2 py-1.5 font-mono text-[10px] leading-4 text-white shadow-lg"
		>
			<div>area={focusedArea}</div>
			<div>active={activeElement}</div>
			<div>editable={editable}</div>
			<div>sidebarViewerMounted={String(sidebarViewerMounted)}</div>
			<div>artifactNavigation={artifactNavigation}</div>
			<div>scopes={activeScopes.join(',') || 'none'}</div>
			<div>
				lastHotkey=
				{lastHotkey
					? `${lastHotkey.outcome}:${lastHotkey.key} (${lastHotkey.reason}; target=${lastHotkey.target})`
					: 'none'}
			</div>
		</aside>
	)
}
