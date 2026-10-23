import type { DiffStyle } from '@humanlayer/ui/components/diff-style-provider'
import { fitDiffStyle, fitsSplitDiff } from '@humanlayer/ui/lib/diff-review/fit-diff-style'
import { useCallback, useState } from 'react'

export interface FittedDiffStyle {
	/** The style to render: the saved choice, or unified when the pane is too narrow for split. */
	diffStyle: DiffStyle
	splitFits: boolean
	/** Attach to the diff pane; its width decides whether split view fits. */
	paneRef: (node: HTMLElement | null) => (() => void) | undefined
}

/**
 * Renders unified view while the diff pane is too narrow for split, without touching the saved
 * choice. Measures on attach, before paint, so a narrow pane never flashes split view.
 */
export function useFittedDiffStyle(preferred: DiffStyle): FittedDiffStyle {
	const [splitFits, setSplitFits] = useState(true)
	const paneRef = useCallback((node: HTMLElement | null) => {
		if (!node) return undefined
		setSplitFits(fitsSplitDiff(node.getBoundingClientRect().width))
		if (typeof ResizeObserver === 'undefined') return undefined
		const observer = new ResizeObserver((entries) => {
			const entry = entries.at(-1)
			if (entry) setSplitFits(fitsSplitDiff(entry.contentRect.width))
		})
		observer.observe(node)
		return () => observer.disconnect()
	}, [])
	return { diffStyle: fitDiffStyle(preferred, splitFits), splitFits, paneRef }
}
