'use client'

import { cn } from '@humanlayer/ui/lib/utils'
import { Expand } from 'lucide-react'
import { type FC, useEffect, useRef, useState } from 'react'
import { Button } from './button'
import { Dialog, DialogContent } from './dialog'

export interface MermaidDiagramProps {
	code: string
	className?: string
	/** Max width constraint, defaults to 100% */
	maxWidth?: string
	/** Show fullscreen button, defaults to true */
	showFullscreenButton?: boolean
}

// Resolved theme variables cached per data-theme value. The first
// getComputedStyle().getPropertyValue() after a DOM mutation flushes a full-document
// style recalculation — profiled as the single most expensive read on the session
// page (it runs right after `innerHTML = svg`). Reading the data-theme attribute is
// free, and it is the only input that changes these values (the component's
// MutationObserver watches the same attribute).
let cachedThemeVariables: Record<string, string> | null = null
let cachedThemeAttr: string | null = null

/**
 * Read computed CSS variable values from the document root and map to mermaid themeVariables.
 * Mermaid does not support CSS variables directly, so we resolve them at render time.
 * Uses theme: 'base' with themeVariables to override all colors.
 * ref: https://mermaid.js.org/config/theming.html#theme-variables-reference-table
 */
function getThemeVariables(): Record<string, string> {
	const themeAttr = document.documentElement.getAttribute('data-theme') ?? ''
	if (cachedThemeVariables && cachedThemeAttr === themeAttr) {
		return cachedThemeVariables
	}
	const style = getComputedStyle(document.documentElement)
	const get = (name: string) => style.getPropertyValue(name).trim()

	const bg = get('--terminal-bg') || '#002b36'
	const bgAlt = get('--terminal-bg-alt') || '#073642'
	const fg = get('--terminal-fg') || '#839496'
	const fgDim = get('--terminal-fg-dim') || '#586e75'
	const accent = get('--terminal-accent') || '#268bd2'
	const border = get('--terminal-border') || '#586e75'

	cachedThemeAttr = themeAttr
	cachedThemeVariables = {
		background: 'transparent',
		primaryColor: bgAlt,
		primaryTextColor: fg,
		primaryBorderColor: accent,
		secondaryColor: bg,
		secondaryTextColor: fg,
		secondaryBorderColor: border,
		tertiaryColor: bgAlt,
		tertiaryTextColor: fg,
		tertiaryBorderColor: border,
		lineColor: fgDim,
		textColor: fg,
		clusterBkg: bgAlt,
		clusterBorder: accent,
		titleColor: fg,
		nodeTextColor: fg,
		// Use sans-serif so mermaid's font-width estimation is accurate for foreignObject sizing
		fontFamily:
			'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
		fontSize: '14px',
		nodeBorder: '1px',
		nodeRadius: '0px',
		// ER diagram contrast: make attribute rows use dark bg with light text
		attributeBackgroundColorEven: bgAlt,
		attributeBackgroundColorOdd: bg,
	}
	return cachedThemeVariables
}

/**
 * Post-render fix: directly set fill/stroke on SVG elements that mermaid renders
 * with light/white backgrounds. Using DOM attributes beats mermaid's scoped CSS.
 */
function fixDarkModeContrast(svgEl: SVGElement) {
	const vars = getThemeVariables()
	const bg = vars.secondaryColor
	const bgAlt = vars.primaryColor
	const border = vars.secondaryBorderColor
	const accent = vars.primaryBorderColor

	const setFill = (el: Element, fill: string, stroke?: string) => {
		el.setAttribute('fill', fill)
		if (stroke) el.setAttribute('stroke', stroke)
	}

	// Read phase before write phase: each getComputedStyle read after an attribute write
	// forces a style recalc of the document, so interleaving reads and writes cost one
	// recalc per element (measured at ~4ms each in WKWebView on a large page).
	const rects = Array.from(svgEl.querySelectorAll('rect'))
	const rectFills = rects.map((rect) => getComputedStyle(rect).fill)

	// All rects: find light-colored ones and darken them
	for (let i = 0; i < rects.length; i++) {
		const rect = rects[i]!
		const fill = rectFills[i]!
		// Match white, near-white, or light gray fills
		if (isLightFill(fill)) {
			const cls = rect.getAttribute('class') || ''
			const parentCls = rect.parentElement?.getAttribute('class') || ''
			// Gantt section rows
			if (cls.includes('section')) {
				setFill(rect, bg ?? '')
			}
			// ER attribute rows
			else if (cls.includes('row-rect')) {
				setFill(rect, (cls.includes('even') ? bgAlt : bg) ?? '')
			}
			// Sequence actor boxes
			else if (cls.includes('actor')) {
				setFill(rect, bgAlt ?? '', accent ?? '')
			}
			// Sequence activation bars
			else if (cls.includes('activation')) {
				setFill(rect, bgAlt ?? '', border ?? '')
			}
			// Sequence loop/alt label boxes
			else if (cls.includes('labelBox')) {
				setFill(rect, bgAlt ?? '', accent ?? '')
			}
			// State diagram composite/cluster backgrounds
			else if (
				cls.includes('composit') ||
				parentCls.includes('stateGroup') ||
				parentCls.includes('statediagram-cluster') ||
				rect.closest('.statediagram-cluster')
			) {
				setFill(rect, bgAlt ?? '', border ?? '')
			}
			// Class diagram boxes
			else if (rect.closest('.classGroup')) {
				setFill(rect, bgAlt ?? '', accent ?? '')
			}
			// Journey section backgrounds
			else if (cls.includes('section') || rect.closest('.section')) {
				setFill(rect, bg ?? '')
			}
			// Generic fallback: darken any remaining light rects
			else {
				setFill(rect, bgAlt ?? '', border ?? '')
			}
		}
	}

	// Fix light-colored lines/paths (same read-then-write split as the rects above)
	const lines = Array.from(svgEl.querySelectorAll('line'))
	const lineStrokes = lines.map((line) => getComputedStyle(line).stroke)
	for (let i = 0; i < lines.length; i++) {
		if (isLightFill(lineStrokes[i]!)) {
			lines[i]!.setAttribute('stroke', border ?? '')
		}
	}
}

/** Check if a computed CSS color value is "light" (high luminance) */
function isLightFill(cssColor: string): boolean {
	const m = cssColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
	if (!m) return false
	const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
	// Relative luminance approximation
	const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
	return lum > 0.55
}

let renderCounter = 0

// Rendered-diagram cache keyed by theme + source. mermaid.render plus the post-render
// fix-ups cost hundreds of ms per diagram (text measurement, style recalcs), and the
// component remounts every time a virtualized row scrolls back into view or the user
// revisits a session — the cached innerHTML replays the final DOM state for free.
// Insertion-ordered Map doubles as an eviction queue.
const renderedSvgCache = new Map<string, string>()
const RENDERED_SVG_CACHE_MAX = 100

export const MermaidDiagram: FC<MermaidDiagramProps> = ({
	code,
	className,
	maxWidth = '100%',
	showFullscreenButton = true,
}) => {
	const containerRef = useRef<HTMLDivElement>(null)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const [isFullscreenOpen, setIsFullscreenOpen] = useState(false)

	// Track data-theme attribute changes on <html> so we re-render on theme switch
	const [dataTheme, setDataTheme] = useState(() =>
		typeof document !== 'undefined'
			? document.documentElement.getAttribute('data-theme') ?? ''
			: '',
	)

	useEffect(() => {
		const observer = new MutationObserver((mutations) => {
			for (const m of mutations) {
				if (m.attributeName === 'data-theme') {
					setDataTheme(document.documentElement.getAttribute('data-theme') ?? '')
				}
			}
		})
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
		return () => observer.disconnect()
	}, [])

	useEffect(() => {
		let cancelled = false
		const renderId = `mermaid-${++renderCounter}`
		const cacheKey = `${dataTheme}\0${code}`

		async function renderDiagram() {
			const cached = renderedSvgCache.get(cacheKey)
			if (cached !== undefined) {
				if (containerRef.current) {
					containerRef.current.innerHTML = cached
					setError(null)
					setLoading(false)
					return
				}
			}

			setLoading(true)
			setError(null)

			try {
				// Lazy-load mermaid (~800kb) only when a diagram is actually rendered.
				// Dynamic import() is code-split by bundlers (Vite/webpack) into a separate chunk.
				// ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import
				const mermaid = (await import('mermaid')).default

				// startOnLoad: false prevents mermaid from scanning the DOM on import.
				// theme: 'base' disables built-in palettes so themeVariables take full control.
				// ref: https://mermaid.js.org/config/usage.html#using-mermaid.run
				mermaid.initialize({
					startOnLoad: false,
					suppressErrorRendering: true,
					theme: 'base',
					themeVariables: getThemeVariables(),
					// Use SVG text instead of foreignObject for accurate node sizing
					htmlLabels: false,
					flowchart: { curve: 'basis', wrappingWidth: 300, padding: 15 },
					sequence: { boxMargin: 4 },
					state: { padding: 12, fontSizeFactor: 7 },
					er: { minEntityWidth: 200, entityPadding: 20 },
					securityLevel: 'strict',
				})

				// mermaid.render() requires a globally unique ID per call — reusing IDs causes
				// rendering failures. We use a module-level counter to guarantee uniqueness.
				// ref: https://github.com/mermaid-js/mermaid/issues/3227
				const { svg, bindFunctions } = await mermaid.render(renderId, code)
				if (!cancelled && containerRef.current) {
					containerRef.current.innerHTML = svg
					const svgEl = containerRef.current.querySelector('svg')
					if (svgEl) {
						// Mermaid estimates foreignObject dimensions using character count × a font factor,
						// which is inaccurate for most fonts. Fix by measuring actual content size
						// and expanding foreignObjects that clip their text. Measure everything first,
						// then write: each scrollWidth read after a size write forces a fresh layout.
						const foMeasurements = Array.from(svgEl.querySelectorAll('foreignObject')).flatMap(
							(fo) => {
								const child = fo.firstElementChild as HTMLElement | null
								return child ? [{ fo, w: child.scrollWidth, h: child.scrollHeight }] : []
							},
						)
						for (const { fo, w, h } of foMeasurements) {
							const foW = Number.parseFloat(fo.getAttribute('width') || '0')
							const foH = Number.parseFloat(fo.getAttribute('height') || '0')
							if (w > foW + 1) {
								fo.setAttribute('width', String(w + 4))
							}
							if (h > foH + 1) {
								fo.setAttribute('height', String(h + 4))
							}
						}
						// Fix contrast: mermaid's scoped CSS uses #id prefixes with high
						// specificity, so we set fill/stroke attributes directly on elements.
						fixDarkModeContrast(svgEl)
					}
					// Force square corners on all SVG rects (sequence diagram actors, notes, etc.)
					for (const rect of Array.from(containerRef.current.querySelectorAll('rect'))) {
						rect.setAttribute('rx', '0')
						rect.setAttribute('ry', '0')
					}
					// Cache the fully post-processed markup so remounts skip render + fix-ups.
					// Diagrams with bindFunctions carry event handlers that innerHTML cannot
					// capture, so those render fresh every time.
					if (!bindFunctions) {
						if (renderedSvgCache.size >= RENDERED_SVG_CACHE_MAX) {
							const oldest = renderedSvgCache.keys().next().value
							if (oldest !== undefined) renderedSvgCache.delete(oldest)
						}
						renderedSvgCache.set(cacheKey, containerRef.current.innerHTML)
					}
					// bindFunctions attaches interactive event handlers (e.g. click on nodes)
					// ref: https://mermaid.js.org/config/usage.html#binding-events
					bindFunctions?.(containerRef.current)
					setLoading(false)
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : 'Failed to render diagram')
					setLoading(false)
				}
			}
		}

		renderDiagram()
		return () => {
			cancelled = true
			// mermaid.render() can leave orphaned temp elements in the DOM on re-render/unmount.
			// ref: https://github.com/mermaid-js/mermaid/issues/786
			// ref: https://github.com/mermaid-js/mermaid/issues/357
			if (containerRef.current) {
				containerRef.current.innerHTML = ''
			}
			document.getElementById(renderId)?.remove()
		}
	}, [code, dataTheme])

	if (error) {
		return (
			<div
				className={cn('text-xs font-mono bg-muted/50 rounded p-2 overflow-auto', className)}
				style={{ maxWidth }}
			>
				<pre className="whitespace-pre-wrap text-muted-foreground">{code}</pre>
				{/* Inline styles required: prose-terminal CSS reset sets margin:0 on all descendants */}
				<div
					className="text-[10px] text-muted-foreground/60 italic"
					style={{ marginTop: '8px', marginBottom: '8px', marginLeft: '12px' }}
				>
					mermaid syntax error, showing source
				</div>
			</div>
		)
	}

	return (
		<>
			<div className="relative" style={{ maxWidth }}>
				<div
					ref={containerRef}
					className={cn(
						'overflow-x-auto [&_svg]:max-w-full',
						loading && 'animate-pulse bg-muted rounded h-24',
						className,
					)}
				/>
				{showFullscreenButton && !loading && !error && (
					<div className="absolute right-2 top-2" contentEditable={false}>
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6"
							onClick={(e) => {
								e.stopPropagation()
								setIsFullscreenOpen(true)
							}}
							onMouseDown={(e) => e.stopPropagation()}
						>
							<Expand className="h-3.5 w-3.5 text-accent hover:text-accent/80 transition-colors" />
						</Button>
					</div>
				)}
			</div>

			<Dialog open={isFullscreenOpen} onOpenChange={setIsFullscreenOpen}>
				<DialogContent
					className="!max-w-[95vw] !w-[95vw] !h-[95vh] !p-2 !gap-0 overflow-auto [&_svg]:!max-w-none [&_svg]:!w-full [&_svg]:!h-auto"
					onEscapeKeyDown={(e) => e.stopPropagation()}
				>
					<MermaidDiagram code={code} showFullscreenButton={false} maxWidth="none" className="w-full [&>div]:w-full" />
				</DialogContent>
			</Dialog>
		</>
	)
}
