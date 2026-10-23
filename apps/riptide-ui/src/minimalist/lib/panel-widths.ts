/**
 * Widths of the resizable panes. A drag sets a CSS variable on the minimalist root, so the
 * layout follows the pointer without a React render, and the width is kept for next time.
 */
export const PANES = {
	sidebar: { variable: '--sidebar-w', label: 'sidebar', min: 200, max: 480 },
	'task-nav': { variable: '--task-nav-w', label: 'task outline', min: 180, max: 480 },
	'task-right': { variable: '--task-right-w', label: 'right panel', min: 280, max: 760 },
	panel: { variable: '--panel-w', label: 'side panel', min: 320, max: 1000 },
	'changed-files': { variable: '--changed-files-w', label: 'file tree', min: 160, max: 600 },
} as const

export type PaneId = keyof typeof PANES

const key = (pane: PaneId) => `hl-min-width-${pane}`

export function clampWidth(pane: PaneId, width: number): number {
	const { min, max } = PANES[pane]
	return Math.round(Math.min(max, Math.max(min, width)))
}

export function storedWidth(pane: PaneId): number | null {
	try {
		const value = Number(localStorage.getItem(key(pane)))
		return value > 0 ? clampWidth(pane, value) : null
	} catch {
		return null
	}
}

/** Null forgets the width, so the pane goes back to its default. */
export function saveWidth(pane: PaneId, width: number | null) {
	try {
		if (width === null) localStorage.removeItem(key(pane))
		else localStorage.setItem(key(pane), String(width))
	} catch {
		// The width still applies for this visit when the browser blocks storage.
	}
}

/** The saved widths as CSS variables, for the minimalist root's first render. */
export function storedWidthStyle(): Record<string, string> {
	const style: Record<string, string> = {}
	for (const pane of Object.keys(PANES) as PaneId[]) {
		const width = storedWidth(pane)
		if (width !== null) style[PANES[pane].variable] = `${width}px`
	}
	return style
}
