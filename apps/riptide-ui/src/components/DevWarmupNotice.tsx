import { useState } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'

type WarmupHotContext = {
	on: (event: 'vite:afterUpdate', callback: () => void) => void
	off: (event: 'vite:afterUpdate', callback: () => void) => void
	dispose: (callback: () => void) => void
}

// DEV is Vite's serving mode, not the release channel (packaged dev builds are production).
export function DevWarmupNotice({ hot = import.meta.hot }: { hot?: WarmupHotContext | null }) {
	if (!import.meta.env.DEV || !hot) return null
	return <ActiveDevWarmupNotice hot={hot} />
}

function ActiveDevWarmupNotice({ hot }: { hot: WarmupHotContext }) {
	const [visible, setVisible] = useState(true)

	useMountEffect(() => {
		// Fast Refresh may preserve dismissed state when this component itself changes.
		setVisible(true)
		const show = () => setVisible(true)
		hot.on('vite:afterUpdate', show)
		let disposed = false
		const cleanup = () => {
			if (disposed) return
			disposed = true
			hot.off('vite:afterUpdate', show)
		}
		hot.dispose(cleanup)
		return cleanup
	})

	if (!visible) return null

	// No timer: elapsed time or completed HMR does not mean lazy routes are warmed up.
	return (
		<aside
			aria-label="Development performance notice"
			className="fixed bottom-10 left-3 z-40 flex max-w-sm items-start gap-3 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground shadow-sm"
		>
			<p role="status">
				<span className="font-medium text-foreground">Development · Vite HMR</span>
				<br />
				First renders after startup or code changes may be slower while Vite rebuilds modules. Allow warm-up
				before profiling.
			</p>
			<button
				type="button"
				aria-label="Dismiss development performance notice"
				className="shrink-0 rounded px-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
				onClick={() => setVisible(false)}
			>
				×
			</button>
		</aside>
	)
}
