import logger from '@/logger'

export const ORPHAN_CHECK_INTERVAL_MS = 5000

export function startOrphanDetection(onOrphaned: () => void): () => void {
	const originalPpid = process.ppid

	if (originalPpid === 1) {
		logger.info({ originalPpid }, 'Daemon started with ppid=1, orphan detection disabled')
		return () => {}
	}

	let orphaned = false
	const interval = setInterval(() => {
		if (orphaned || process.ppid !== 1) {
			return
		}

		orphaned = true
		logger.warn({ originalPpid, currentPpid: process.ppid }, 'Parent process died, daemon is orphaned')
		onOrphaned()
	}, ORPHAN_CHECK_INTERVAL_MS)

	logger.info({ originalPpid, intervalMs: ORPHAN_CHECK_INTERVAL_MS }, 'Orphan detection started')

	return () => {
		clearInterval(interval)
		logger.info('Orphan detection stopped')
	}
}
