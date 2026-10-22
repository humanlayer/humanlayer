export const SIDEBAR_NAV_ITEMS = [
	// Array order is render order and cycle order.
	{ value: 'graph', label: 'Graph' },
	{ value: 'artifacts', label: 'Artifacts' },
	{ value: 'github', label: 'GitHub' },
	{ value: 'changes', label: 'Changes' },
	{ value: 'diffs', label: 'Diffs' },
	{ value: 'workspace', label: 'Workspace' },
	{ value: 'scratch-pad', label: 'Scratch Pad' },
	{ value: 'minimap', label: 'Minimap' },
	{ value: 'tips', label: 'Tips' },
	{ value: 'todos', label: 'Todos' },
	{ value: 'auto-advance', label: 'Auto-Advance' },
] as const

export type SidebarTab = (typeof SIDEBAR_NAV_ITEMS)[number]['value']

export type SidebarTabVisibility = Partial<Record<SidebarTab, boolean>>

/** Returns visible tabs in the canonical navigation order. */
export function getVisibleSidebarTabs(visibility: SidebarTabVisibility): SidebarTab[] {
	return SIDEBAR_NAV_ITEMS.filter((item) => visibility[item.value] ?? false).map((item) => item.value)
}
