export const FOCUSED_AREAS = {
	LEFT_NAV: 'LEFT_NAV',
	MAIN: 'MAIN',
	RIGHT_PANE: 'RIGHT_PANE',
} as const

export type FocusedArea = (typeof FOCUSED_AREAS)[keyof typeof FOCUSED_AREAS]

export function isFocusedArea(value: string | undefined): value is FocusedArea {
	return value !== undefined && Object.values(FOCUSED_AREAS).includes(value as FocusedArea)
}
