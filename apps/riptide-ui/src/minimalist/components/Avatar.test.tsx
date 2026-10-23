import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Avatar } from './Avatar'

describe('Avatar', () => {
	it('keeps initials under the picture, shows the picture once it loads and drops it when it fails', () => {
		const { container, rerender } = render(<Avatar name="Ada Lovelace" src="https://example.com/ada.png" />)
		const img = container.querySelector('img')
		expect(container.textContent).toBe('AL')
		expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer')
		fireEvent.load(img as HTMLImageElement)
		expect(img?.classList.contains('loaded')).toBe(true)
		rerender(<Avatar name="Ada Lovelace" src="https://example.com/broken.png" />)
		fireEvent.error(container.querySelector('img') as HTMLImageElement)
		expect(container.querySelector('img')).toBeNull()
		expect(container.textContent).toBe('AL')
	})
})
