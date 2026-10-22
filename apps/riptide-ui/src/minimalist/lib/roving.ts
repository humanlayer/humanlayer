import type { KeyboardEvent } from 'react'

const NEXT = new Map([
	['ArrowRight', 1],
	['ArrowDown', 1],
	['ArrowLeft', -1],
	['ArrowUp', -1],
])

/**
 * Arrow keys, Home and End for a row of tabs or radio buttons, on the row's `onKeyDown`:
 * move to the neighbor and select it, wrapping at the ends. Only the selected item sits in
 * the tab order (`tabIndex={selected ? 0 : -1}`), so Tab leaves the row in one press.
 */
export function selectWithArrows(event: KeyboardEvent<HTMLElement>) {
	const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"], [role="radio"]')]
	const at = items.findIndex((item) => item === document.activeElement)
	if (at === -1 || items.length < 2) return
	const step = NEXT.get(event.key)
	let to: number
	if (step) to = (at + step + items.length) % items.length
	else if (event.key === 'Home') to = 0
	else if (event.key === 'End') to = items.length - 1
	else return
	event.preventDefault()
	items[to]?.focus()
	items[to]?.click()
}
