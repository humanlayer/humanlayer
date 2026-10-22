import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import type { DependencyList } from 'react'

function isFormField(element: Element | null): boolean {
	return (
		element instanceof HTMLInputElement ||
		element instanceof HTMLTextAreaElement ||
		element instanceof HTMLSelectElement
	)
}

/**
 * Submits from non-editor form fields when plain Enter is configured. Rich-text
 * editors keep their own Enter handling so suggestion menus retain priority.
 */
export function useFormFieldSubmitHotkey(
	onSubmit: () => void,
	{ enabled, scope }: { enabled: boolean; scope: string },
	dependencies: DependencyList = [],
): void {
	useHotkeys(
		'enter',
		(event) => {
			if (!isFormField(document.activeElement)) return
			event.preventDefault()
			onSubmit()
		},
		{
			enabled,
			enableOnFormTags: true,
			enableOnContentEditable: false,
			scopes: [scope],
		},
		dependencies,
	)
}
