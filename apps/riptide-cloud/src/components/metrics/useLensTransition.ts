import type { ScatterDataPoint } from '@humanlayer/ui/components/charts/scatter-chart'
import { useEffect, useRef, useState } from 'react'

import { easeInOutCubic, mixPoints, projectPoints } from './scatterViews'

const TRANSITION_MS = 600

/**
 * The lens switch's signature move: the dots are the same contributors on
 * every lens (x = spend never moves), so instead of re-popping the chart,
 * each dot SLIDES from where the viewer last saw it to its new y — who
 * collapses when you switch from LOC to commits is the story, and the motion
 * is what makes it legible.
 *
 * The AXIS is deliberately NOT tweened: recharts must see exactly one
 * y-domain change per switch (a per-frame domain array sends its internal
 * tick-reporting store into a "Maximum update depth exceeded" loop), so the
 * caller passes the target domain straight through and this hook projects
 * the previously rendered points into that domain's space — a dot 30% up the
 * old axis starts 30% up the new one — then tweens data-space values under
 * the fixed new domain.
 *
 * `animationKey` names the view (lens + week window): when it changes, the
 * tween runs from the previously RENDERED frame; when it doesn't (a
 * background refetch, a filter change), values snap — animating a data
 * correction would misrepresent it as a view change. A cold window switch
 * (target window not yet cached) tweens toward an empty array — a no-op —
 * and the fetched points then snap in as a data refresh. Honors
 * prefers-reduced-motion by snapping. recharts' own series animation is off
 * (scatter-chart.tsx), so this is the only animator.
 */
export function useLensTransition(
	points: ScatterDataPoint[],
	domain: [number, number],
	animationKey: string,
): ScatterDataPoint[] {
	const [display, setDisplay] = useState<ScatterDataPoint[]>(points)
	// The tween's "from" is whatever is currently ON SCREEN — mid-flight
	// switches continue from the rendered frame, not the stale target.
	const renderedRef = useRef<{ points: ScatterDataPoint[]; domain: [number, number] }>({ points, domain })
	const keyRef = useRef(animationKey)
	renderedRef.current = { points: display, domain: renderedRef.current.domain }

	useEffect(() => {
		const keyChanged = keyRef.current !== animationKey
		keyRef.current = animationKey

		const reduceMotion =
			typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

		if (!keyChanged || reduceMotion) {
			renderedRef.current = { points, domain }
			setDisplay(points)
			return
		}

		// Carry the on-screen positions into the NEW domain's space, so the
		// axis can snap while every dot still departs from where it stood.
		const from = projectPoints(renderedRef.current.points, renderedRef.current.domain, domain)
		renderedRef.current = { points: from, domain }

		const start = performance.now()
		let frame = requestAnimationFrame(function tick(now: number) {
			const t = Math.min(1, (now - start) / TRANSITION_MS)
			setDisplay(mixPoints(from, points, easeInOutCubic(t)))
			if (t < 1) frame = requestAnimationFrame(tick)
		})
		return () => cancelAnimationFrame(frame)
	}, [points, domain, animationKey])

	return display
}
