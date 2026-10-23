import { FOCUSED_AREAS } from '@/hooks/stores/focus-areas'
import { useFocusStore } from '@/hooks/stores/focusStore'

export const RIGHT_PANE_FOCUS_SURFACE_ATTRIBUTE = 'data-right-pane-focus-surface'

export function rightPaneFocusSurface(targetDocument: Document = document): HTMLElement | null {
	return (
		targetDocument.querySelector<HTMLElement>(`[${RIGHT_PANE_FOCUS_SURFACE_ATTRIBUTE}="fullscreen"]`) ??
		targetDocument.querySelector<HTMLElement>(
			`[data-state="active"] [data-scratch-pad-mode][${RIGHT_PANE_FOCUS_SURFACE_ATTRIBUTE}="sidebar"]`,
		) ??
		targetDocument.querySelector<HTMLElement>(`[${RIGHT_PANE_FOCUS_SURFACE_ATTRIBUTE}="sidebar"]`)
	)
}

export function focusRightPaneSurface(targetDocument: Document = document): void {
	rightPaneFocusSurface(targetDocument)?.focus({ preventScroll: true })
}

function releaseSpatialDomFocus(targetDocument: Document): void {
	const activeElement = targetDocument.activeElement
	if (
		activeElement instanceof HTMLElement &&
		activeElement.closest(
			`[data-focus-area="${FOCUSED_AREAS.LEFT_NAV}"], [data-focus-area="${FOCUSED_AREAS.RIGHT_PANE}"]`,
		)
	) {
		activeElement.blur()
	}
}

export function moveKeyboardFocusRight(rightPaneAvailable: boolean, targetDocument: Document = document): void {
	const previousArea = useFocusStore.getState().focusedArea
	useFocusStore.getState().moveFocusRight(rightPaneAvailable)
	const nextArea = useFocusStore.getState().focusedArea
	if (nextArea === 'RIGHT_PANE') {
		focusRightPaneSurface(targetDocument)
	} else if (previousArea === 'LEFT_NAV' && nextArea === 'MAIN') {
		releaseSpatialDomFocus(targetDocument)
	}
}

export function moveKeyboardFocusLeft(rightPaneAvailable: boolean, targetDocument: Document = document): void {
	const previousArea = useFocusStore.getState().focusedArea
	useFocusStore.getState().moveFocusLeft(rightPaneAvailable)
	if (useFocusStore.getState().focusedArea === 'MAIN' && previousArea !== 'MAIN') {
		releaseSpatialDomFocus(targetDocument)
	}
}

export function focusMainAndReleaseSpatialDomFocus(targetDocument: Document = document): void {
	useFocusStore.getState().focusMain()
	releaseSpatialDomFocus(targetDocument)
}

export const leaveRightPaneForMain = focusMainAndReleaseSpatialDomFocus
