import { useSyncExternalStore } from 'react'

const EDITABLE_SELECTOR =
	'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"]'

export function isEditableElement(target: EventTarget | null): target is HTMLElement {
	return target instanceof HTMLElement && (target.isContentEditable || target.matches(EDITABLE_SELECTOR))
}

export function eventHasEditableTarget(event: Event): boolean {
	return event.composedPath().some(isEditableElement)
}

function deepestActiveElement(root: Document | ShadowRoot): Element | null {
	let active = root.activeElement
	while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
	return active
}

export function editableHasDomFocus(doc: Document = document): boolean {
	return isEditableElement(deepestActiveElement(doc))
}

function subscribeToEditableFocus(onStoreChange: () => void): () => void {
	document.addEventListener('focusin', onStoreChange, true)
	document.addEventListener('focusout', onStoreChange, true)
	return () => {
		document.removeEventListener('focusin', onStoreChange, true)
		document.removeEventListener('focusout', onStoreChange, true)
	}
}

export function useEditableFocus(): boolean {
	return useSyncExternalStore(subscribeToEditableFocus, editableHasDomFocus, () => false)
}
