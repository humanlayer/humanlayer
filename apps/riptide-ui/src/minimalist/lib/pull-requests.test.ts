import { describe, expect, it } from 'vitest'

import { pullRequestBadge } from '@/minimalist/lib/pull-requests'

const open = { state: 'open', isDraft: false, reviewDecision: null }
const checks = (failed = 0, running = 0, passed = 0) => ({
	failed: Array.from({ length: failed }),
	running: Array.from({ length: running }),
	passed: Array.from({ length: passed }),
})

describe('pullRequestBadge', () => {
	it('puts merged and closed before checks', () => {
		expect(pullRequestBadge({ ...open, state: 'merged' }, checks(2))).toEqual({ label: 'Merged', tone: 'muted' })
		expect(pullRequestBadge({ ...open, state: 'closed' }, checks(2))).toEqual({ label: 'Closed', tone: 'muted' })
	})

	it('counts failing checks first, then running ones', () => {
		expect(pullRequestBadge(open, checks(2, 1, 5))).toEqual({ label: '2 failing', tone: 'del' })
		expect(pullRequestBadge(open, checks(0, 3, 5))).toEqual({ label: '3 running', tone: 'muted' })
	})

	it('falls back to reviews, draft and passing checks', () => {
		expect(pullRequestBadge({ ...open, reviewDecision: 'CHANGES_REQUESTED' }, checks(0, 0, 1)).label).toBe(
			'Changes requested',
		)
		expect(pullRequestBadge({ ...open, isDraft: true }, checks(0, 0, 1)).label).toBe('Draft')
		expect(pullRequestBadge({ ...open, reviewDecision: 'APPROVED' }, checks(0, 0, 1)).label).toBe('Approved')
		expect(pullRequestBadge(open, checks(0, 0, 1))).toEqual({ label: 'Checks pass', tone: 'add' })
		expect(pullRequestBadge(open, checks())).toEqual({ label: 'Open', tone: 'muted' })
	})
})
