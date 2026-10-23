import { type HotkeyCallback, type Keys, type Options, useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { type DependencyList, type RefObject, useCallback, useLayoutEffect, useRef } from 'react'

import { hotkeyDebugLabel, recordHotkeyDebugEvent } from '@/hooks/hotkeys/focus-debug'
import { type FocusedArea, useFocusStore } from '@/hooks/stores/focusStore'

import { editableHasDomFocus, eventHasEditableTarget } from './editable-focus'
import { resolvePlatformHotkeys } from './platform-hotkeys'

export type AppHotkeysOptions = Options & {
	/** Restrict this registration to its spatial keyboard owner. */
	area?: FocusedArea | readonly FocusedArea[]
}

type HotkeysEvent = Parameters<HotkeyCallback>[1]

type CurrentAppHotkey = Pick<AppHotkeysOptions, 'area' | 'enabled' | 'ignoreEventWhen' | 'preventDefault'> & {
	guardEditable: boolean
	callback: HotkeyCallback
	keyLabel: string
}

function isTextEntryHotkey(keys: Keys): boolean {
	const alternatives = (Array.isArray(keys) ? keys : [keys]).flatMap((key) => key.split(','))
	return alternatives.some((alternative) => {
		const normalized = alternative.trim().toLowerCase()
		return (
			!normalized.includes('ctrl+') &&
			!normalized.includes('meta+') &&
			!normalized.includes('mod+') &&
			!normalized.includes('alt+')
		)
	})
}

function areaOwnsHotkey(area: AppHotkeysOptions['area']): boolean {
	if (!area) return true
	const focusedArea = useFocusStore.getState().focusedArea
	return Array.isArray(area) ? area.includes(focusedArea) : focusedArea === area
}

function rejectionReason(current: CurrentAppHotkey, event: KeyboardEvent, hotkeysEvent?: HotkeysEvent): string | null {
	if (typeof current.enabled !== 'function' && !current.enabled) return 'disabled'
	if (!areaOwnsHotkey(current.area)) return `area is ${useFocusStore.getState().focusedArea}`
	if (current.ignoreEventWhen?.(event)) return 'caller ignoreEventWhen'
	if (
		current.guardEditable &&
		(eventHasEditableTarget(event) || editableHasDomFocus(event.view?.document ?? document))
	) {
		return 'editable owns DOM focus'
	}
	if (hotkeysEvent && typeof current.enabled === 'function' && !current.enabled(event, hotkeysEvent)) {
		return 'dynamic enabled returned false'
	}
	return null
}

/**
 * App hotkey seam. Text-producing keys never escape an editable, and contested
 * registrations can name their single spatial owner without duplicating store
 * predicates at every call site.
 */
export function useAppHotkeys<T extends HTMLElement = HTMLElement>(
	keys: Keys,
	callback: HotkeyCallback,
	options: AppHotkeysOptions = {},
	dependencies: DependencyList = [],
): RefObject<T | null> {
	const platformKeys = resolvePlatformHotkeys(keys)
	const { area, enabled = true, ignoreEventWhen, preventDefault, ...hotkeyOptions } = options
	const latest = useRef({
		area,
		enabled,
		ignoreEventWhen,
		preventDefault,
		guardEditable: isTextEntryHotkey(platformKeys),
		callback,
		keyLabel: hotkeyDebugLabel(platformKeys),
	})
	useLayoutEffect(() => {
		latest.current = {
			area,
			enabled,
			ignoreEventWhen,
			preventDefault,
			guardEditable: isTextEntryHotkey(platformKeys),
			callback,
			keyLabel: hotkeyDebugLabel(platformKeys),
		}
	})
	const appIgnoreEventWhen = useCallback((event: KeyboardEvent) => {
		const current = latest.current
		const reason = rejectionReason(current, event)
		if (reason) {
			recordHotkeyDebugEvent({ key: current.keyLabel, outcome: 'rejected', reason, event })
			return true
		}
		return false
	}, [])
	const appCallback: HotkeyCallback = useCallback((event, hotkeysEvent) => {
		const current = latest.current
		const reason = rejectionReason(current, event, hotkeysEvent)
		if (reason) {
			recordHotkeyDebugEvent({ key: current.keyLabel, outcome: 'rejected', reason, event })
			return
		}
		if (
			current.preventDefault === true ||
			(typeof current.preventDefault === 'function' && current.preventDefault(event, hotkeysEvent))
		) {
			event.preventDefault()
		}
		recordHotkeyDebugEvent({ key: current.keyLabel, outcome: 'fired', reason: 'accepted', event })
		current.callback(event, hotkeysEvent)
	}, [])

	return useHotkeys<T>(
		platformKeys,
		appCallback,
		{ ...hotkeyOptions, enabled: true, preventDefault: false, ignoreEventWhen: appIgnoreEventWhen },
		dependencies,
	)
}
