import { editableHasDomFocus } from '@/hooks/hotkeys/editable-focus'
import { FOCUSED_AREAS, isFocusedArea, type FocusedArea } from '@/hooks/stores/focus-areas'
import { useFocusStore } from '@/hooks/stores/focusStore'

function firstElementInPath(event: Event): Element | null {
	return event.composedPath().find((target): target is Element => target instanceof Element) ?? null
}

export function resolveFocusArea(event: Event): FocusedArea | null {
	const target = firstElementInPath(event)
	if (!target || target.closest('[role="dialog"], [data-radix-popper-content-wrapper]')) return null
	const area = target.closest<HTMLElement>('[data-focus-area]')?.dataset.focusArea
	return isFocusedArea(area) ? area : null
}

export function claimPointerFocusArea(event: Event): void {
	const area = resolveFocusArea(event)
	if (!area) return
	const store = useFocusStore.getState()
	if (area === FOCUSED_AREAS.LEFT_NAV) store.focusSidebar()
	else if (area === FOCUSED_AREAS.RIGHT_PANE) store.focusRightPane()
	else store.focusMain()
}

export function claimRightPaneFromWheel(event: Event): void {
	if (editableHasDomFocus()) return
	if (resolveFocusArea(event) === FOCUSED_AREAS.RIGHT_PANE) useFocusStore.getState().focusRightPane()
}
