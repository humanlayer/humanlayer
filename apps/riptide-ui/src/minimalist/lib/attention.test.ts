import type { SessionStatus } from '@humanlayer/db/tables/sessions'
import { describe, expect, it } from 'vitest'

import { attentionSections } from '@/minimalist/lib/attention'
import type { TaskRow } from '@/minimalist/lib/data'
import { rollupAttention } from '@/minimalist/lib/status'

const NOON = new Date(2026, 8, 27, 12).getTime()

function row(id: string, statuses: SessionStatus[], lastActivity = NOON): TaskRow {
	const sessions = statuses.map((status, index) => ({ id: `${id}-${index}`, status })) as TaskRow['sessions']
	return {
		task: { id } as TaskRow['task'],
		sessions,
		latest: sessions.at(-1) ?? null,
		attention: rollupAttention(statuses),
		lastActivity,
		projectName: 'p',
	}
}

describe('attentionSections', () => {
	it('keeps running and today as task overviews without deriving notifications', () => {
		const sections = attentionSections(
			[
				row('ask', ['ready_for_input', 'needs_approval']),
				row('failed', ['lost']),
				row('busy', ['running']),
				row('done', ['ready_for_input']),
				row('yesterday', ['ready_for_input'], NOON - 24 * 60 * 60 * 1000),
			],
			NOON,
		)
		expect(sections.running.map((entry) => entry.task.id)).toEqual(['busy'])
		expect(sections.today.map((entry) => entry.task.id)).toEqual(['done'])
		expect(Object.keys(sections)).toEqual(['running', 'today'])
	})

	it('includes midnight and excludes yesterday, even when a quiet task has no sessions', () => {
		const midnight = new Date(NOON).setHours(0, 0, 0, 0)
		const sections = attentionSections([row('midnight', [], midnight), row('yesterday', [], midnight - 1)], NOON)
		expect(sections.today.map((entry) => entry.task.id)).toEqual(['midnight'])
	})

	it('does not turn workspace failures into task overview rows', () => {
		const stuck = { ...row('setup', ['waiting_for_workspace']), attention: 'failed' as const }
		expect(attentionSections([stuck], NOON)).toEqual({ running: [], today: [] })
	})
})
