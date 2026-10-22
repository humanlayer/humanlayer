type RendererLocation = Pick<Location, 'host' | 'pathname' | 'protocol'>

export function isTrustedRenderer(input: {
	readonly location: RendererLocation
	readonly rendererUrl: string | undefined
}): boolean {
	if (input.rendererUrl === undefined) return false

	try {
		const renderer = new URL(input.rendererUrl)
		if (renderer.protocol === 'file:') {
			return input.location.protocol === 'file:' && input.location.pathname === renderer.pathname
		}
		return input.location.protocol === renderer.protocol && input.location.host === renderer.host
	} catch {
		return false
	}
}
