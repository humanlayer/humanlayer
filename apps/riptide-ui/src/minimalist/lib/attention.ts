import type { TaskRow } from '@/minimalist/lib/data'

/** Task overview only. Needs you comes from the shared notification inbox, not task status. */
export function attentionSections(rows: readonly TaskRow[], now = Date.now()) {
	const dayStart = new Date(now).setHours(0, 0, 0, 0)
	return {
		running: rows.filter((row) => row.attention === 'running'),
		today: rows.filter((row) => row.attention === 'idle' && row.lastActivity >= dayStart),
	}
}
