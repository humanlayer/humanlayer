import { describe, expect, it } from 'vitest'

import { enterAction } from '@/minimalist/lib/send-keys'

const enter = { key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false, nativeEvent: { isComposing: false } }

describe('enterAction', () => {
	it('sends on Enter when Enter sends, and adds a line with ⇧', () => {
		expect(enterAction(enter, 'enter', false)).toBe('send')
		expect(enterAction({ ...enter, shiftKey: true }, 'enter', false)).toBeNull()
		expect(enterAction({ ...enter, metaKey: true }, 'enter', true)).toBe('interrupt')
		expect(enterAction({ ...enter, metaKey: true }, 'enter', false)).toBeNull()
	})

	it('sends on ⌘ Enter when that sends, and interrupts with ⇧⌘ Enter', () => {
		expect(enterAction(enter, 'mod+enter', false)).toBeNull()
		expect(enterAction({ ...enter, ctrlKey: true }, 'mod+enter', false)).toBe('send')
		expect(enterAction({ ...enter, metaKey: true, shiftKey: true }, 'mod+enter', true)).toBe('interrupt')
		expect(enterAction({ ...enter, metaKey: true }, 'mod+enter', true)).toBe('send')
	})

	it('leaves other keys and input method composition alone', () => {
		expect(enterAction({ ...enter, key: 'a' }, 'enter', false)).toBeNull()
		expect(enterAction({ ...enter, nativeEvent: { isComposing: true } }, 'enter', false)).toBeNull()
	})
})
