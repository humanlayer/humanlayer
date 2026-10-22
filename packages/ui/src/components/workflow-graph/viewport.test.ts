import { describe, expect, test } from 'vitest'
import { snapViewportToDevicePixels } from './viewport'

describe('snapViewportToDevicePixels', () => {
	test('rounds translations to whole pixels on standard-density displays', () => {
		expect(snapViewportToDevicePixels({ x: 12.4, y: -8.6, zoom: 1.75 }, 1)).toEqual({
			x: 12,
			y: -9,
			zoom: 1.75,
		})
	})

	test('rounds translations to physical pixels on high-density displays', () => {
		expect(snapViewportToDevicePixels({ x: 12.3, y: -8.2, zoom: 2 }, 2)).toEqual({
			x: 12.5,
			y: -8,
			zoom: 2,
		})
	})

	test('uses standard-density snapping for invalid pixel ratios', () => {
		expect(snapViewportToDevicePixels({ x: 1.6, y: 2.4, zoom: 0.5 }, 0)).toEqual({
			x: 2,
			y: 2,
			zoom: 0.5,
		})
	})
})
