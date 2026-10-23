import type { Viewport } from '@xyflow/react'

export function snapViewportToDevicePixels(viewport: Viewport, devicePixelRatio: number): Viewport {
	const pixelRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1

	return {
		x: Math.round(viewport.x * pixelRatio) / pixelRatio,
		y: Math.round(viewport.y * pixelRatio) / pixelRatio,
		zoom: viewport.zoom,
	}
}
