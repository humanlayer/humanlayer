import { describe, expect, it } from 'vitest'

import { shouldPinLatestUserMessage } from './stickyUserMessage'

describe('shouldPinLatestUserMessage', () => {
	it('does not pin while any part of the row remains visible', () => {
		expect(shouldPinLatestUserMessage({ rowStart: 300, rowEnd: 500, scrollTop: 400 })).toBe(false)
	})

	it('does not pin when the row is below the viewport top', () => {
		expect(shouldPinLatestUserMessage({ rowStart: 600, rowEnd: 700, scrollTop: 400 })).toBe(false)
	})

	it('pins once the whole row has scrolled above the viewport', () => {
		expect(shouldPinLatestUserMessage({ rowStart: 200, rowEnd: 300, scrollTop: 400 })).toBe(true)
	})

	it('uses the row start after the virtualizer drops an offscreen row', () => {
		expect(shouldPinLatestUserMessage({ rowStart: 200, rowEnd: undefined, scrollTop: 400 })).toBe(true)
	})
})
