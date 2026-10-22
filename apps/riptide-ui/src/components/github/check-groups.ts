import type { CheckConclusion, CheckRowType } from '@humanlayer/streams/pr-status'
import { isValid, parseISO } from 'date-fns'

import { formatCompactDuration } from '@/lib/format-duration'

export type CheckGroupKind = 'failed' | 'running' | 'passed'

// Grouped by whether the merge is blocked, not by whether the job exited zero: GitHub's merge
// box treats NEUTRAL and SKIPPED as satisfied, and the other non-SUCCESS conclusions as not.
const CONCLUSION_GROUPS: Record<CheckConclusion, CheckGroupKind> = {
	ACTION_REQUIRED: 'failed',
	CANCELLED: 'failed',
	FAILURE: 'failed',
	STALE: 'failed',
	STARTUP_FAILURE: 'failed',
	TIMED_OUT: 'failed',
	NEUTRAL: 'passed',
	SKIPPED: 'passed',
	SUCCESS: 'passed',
}

export const checkGroupOf = (check: CheckRowType): CheckGroupKind =>
	check.conclusion === null ? 'running' : CONCLUSION_GROUPS[check.conclusion]

export interface CheckGroups {
	readonly failed: CheckRowType[]
	readonly running: CheckRowType[]
	readonly passed: CheckRowType[]
	readonly total: number
}

export const groupChecks = (checks: readonly CheckRowType[]): CheckGroups => {
	const groups: CheckGroups = { failed: [], running: [], passed: [], total: checks.length }
	for (const check of checks) groups[checkGroupOf(check)].push(check)
	return groups
}

export const formatCheckDuration = (check: CheckRowType): string | null => {
	if (!check.startedAt || !check.completedAt) return null
	const startedAt = parseISO(check.startedAt)
	const completedAt = parseISO(check.completedAt)
	if (!isValid(startedAt) || !isValid(completedAt)) return null
	return formatCompactDuration(completedAt.getTime() - startedAt.getTime())
}

export const countFailingChecks = (checks: readonly CheckRowType[]): number =>
	checks.reduce((count, check) => (checkGroupOf(check) === 'failed' ? count + 1 : count), 0)
