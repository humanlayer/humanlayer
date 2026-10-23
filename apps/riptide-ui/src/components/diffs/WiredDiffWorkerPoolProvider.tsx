import { useTheme } from '@humanlayer/ui/components/theme-provider'
import { themeToShiki } from '@humanlayer/ui/lib/shiki-theme-mapping'
import { useWorkerPool, WorkerPoolContextProvider } from '@pierre/diffs/react'
import DiffsHighlighterWorker from '@pierre/diffs/worker/worker.js?worker'
import { useEffect, type ReactNode } from 'react'

import { logger } from '@/lib/logger'

// Two workers keep highlighting off the main thread without paying for
// Pierre's default pool of eight; each dev-mode worker fetches the whole
// unbundled module graph, which is expensive in the WKWebView.
const POOL_OPTIONS = { workerFactory: () => new DiffsHighlighterWorker(), poolSize: 2 }

/**
 * Runs Pierre's Shiki highlighting in a shared worker pool instead of the main
 * thread. Mount once at the app shell: Pierre terminates the pool singleton
 * when the last provider unmounts, so mounting per diff surface makes every
 * surface open respawn the workers.
 */
export function WiredDiffWorkerPoolProvider({ children }: { children: ReactNode }) {
	const { theme } = useTheme()
	const shikiTheme = themeToShiki[theme] ?? 'github-dark'
	const workersAvailable = typeof Worker !== 'undefined'
	useEffect(() => {
		if (!workersAvailable) {
			logger.warn('Web Workers unavailable; diff highlighting stays on the main thread')
		}
	}, [workersAvailable])
	if (!workersAvailable) return children
	return (
		<WorkerPoolContextProvider poolOptions={POOL_OPTIONS} highlighterOptions={{ theme: shikiTheme }}>
			<WorkerPoolThemeSync theme={shikiTheme} />
			{children}
		</WorkerPoolContextProvider>
	)
}

/**
 * The pool tokenizes with its own theme, not the per-view option, so app theme
 * changes must be pushed into the pool; Pierre then re-renders subscribed diffs.
 */
function WorkerPoolThemeSync({ theme }: { theme: string }) {
	const pool = useWorkerPool()
	useEffect(() => {
		void pool?.setRenderOptions({ theme })
	}, [pool, theme])
	useEffect(() => {
		if (!pool) return
		let cancelled = false
		pool.initialize()
			.then(() => {
				if (cancelled) return
				const stats = pool.getStats()
				if (stats.workersFailed) {
					logger.warn('Diff highlight worker pool failed; highlighting falls back to the main thread', {
						stats,
					})
				} else {
					logger.info('Diff highlight worker pool ready', { workers: stats.totalWorkers })
				}
			})
			.catch((error: unknown) => {
				if (cancelled) return
				logger.warn('Diff highlight worker pool failed to initialize', {
					error: error instanceof Error ? error.message : String(error),
				})
			})
		return () => {
			cancelled = true
		}
	}, [pool])
	return null
}
