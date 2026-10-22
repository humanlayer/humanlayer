import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { installFileDropNavigationGuard, uninstallFileDropNavigationGuard } from './file-drop-navigation-guard'

// jsdom has no DragEvent, so build a plain event with the parts the guard reads.
function dragEvent(type: 'dragover' | 'drop', types: string[]): Event {
	const event = new Event(type, { bubbles: true, cancelable: true })
	Object.defineProperty(event, 'dataTransfer', {
		value: { types, dropEffect: 'copy' },
	})
	return event
}

describe('file drop navigation guard', () => {
	let target: HTMLDivElement

	beforeEach(() => {
		installFileDropNavigationGuard()
		target = document.createElement('div')
		document.body.append(target)
	})

	afterEach(() => {
		uninstallFileDropNavigationGuard()
		target.remove()
	})

	test('cancels a file drag that no drop zone handled', () => {
		const dragover = dragEvent('dragover', ['Files'])
		const drop = dragEvent('drop', ['Files'])

		target.dispatchEvent(dragover)
		target.dispatchEvent(drop)

		expect(dragover.defaultPrevented).toBe(true)
		expect(drop.defaultPrevented).toBe(true)
		expect((dragover as unknown as DragEvent).dataTransfer?.dropEffect).toBe('none')
	})

	// WebKitGTK reports a dragged file this way and never sets `Files`.
	test('cancels a uri drag, which is how some engines report a dropped file', () => {
		const drop = dragEvent('drop', ['text/uri-list', 'text/html'])

		target.dispatchEvent(drop)

		expect(drop.defaultPrevented).toBe(true)
	})

	test('leaves a non-file drag alone so text still drops into inputs', () => {
		const drop = dragEvent('drop', ['text/plain'])

		target.dispatchEvent(drop)

		expect(drop.defaultPrevented).toBe(false)
	})

	test('never sees a file drop that a drop zone stopped', () => {
		const zone = document.createElement('div')
		zone.addEventListener('drop', (event) => event.stopPropagation())
		target.append(zone)

		const drop = dragEvent('drop', ['Files'])
		zone.dispatchEvent(drop)

		expect(drop.defaultPrevented).toBe(false)
	})
})
