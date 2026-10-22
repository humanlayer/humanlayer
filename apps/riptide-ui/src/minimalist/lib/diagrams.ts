let renders = 0

/**
 * A mermaid diagram as SVG, in the minimalist theme. Mermaid loads on first use, since most
 * documents have no diagram. Strict mode sanitizes the SVG it returns, so it can go in the page.
 * A diagram that won't parse rejects; mermaid is told not to draw its error graphic into the page.
 */
export async function renderDiagram(source: string, dark: boolean): Promise<string> {
	const { default: mermaid } = await import('mermaid')
	mermaid.initialize({
		startOnLoad: false,
		securityLevel: 'strict',
		suppressErrorRendering: true,
		theme: dark ? 'dark' : 'neutral',
		fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif",
	})
	renders += 1
	const id = `minimalist-diagram-${renders}`
	try {
		const { svg } = await mermaid.render(id, source)
		return svg
	} finally {
		// Mermaid measures in a scratch element it can leave behind when rendering fails.
		document.getElementById(`d${id}`)?.remove()
	}
}
