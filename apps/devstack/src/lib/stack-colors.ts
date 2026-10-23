import type { DevstackRegistry } from './registry'

// Static copy of the Poimandres accent palette used by packages/ui.
export const DEVSTACK_COLORS = ['#d0679d', '#5de4c7', '#fffac2', '#89ddff', '#f087bd', '#add7ff'] as const

export function allocateStackColor(registry: DevstackRegistry, preferredIndex: number): string {
	const usedColors = new Set(Object.values(registry.stacks).map((stack) => stack.tabColor))
	for (let offset = 0; offset < DEVSTACK_COLORS.length; offset += 1) {
		const color = DEVSTACK_COLORS[(preferredIndex + offset) % DEVSTACK_COLORS.length]
		if (color !== undefined && !usedColors.has(color)) return color
	}
	return DEVSTACK_COLORS[preferredIndex % DEVSTACK_COLORS.length] ?? DEVSTACK_COLORS[0]
}
