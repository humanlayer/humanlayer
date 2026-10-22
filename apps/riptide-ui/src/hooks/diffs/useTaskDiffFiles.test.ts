import { parseTaskDiffFileRow, type TaskDiffFileRowType } from '@humanlayer/streams/diff'
import { describe, expect, test } from 'vitest'

import { orderTaskDiffFiles, rankTaskDiffFilesByRecency } from './sort-task-diff-files'
import { getTaskDiffEligibilityStatus, isTaskDiffEligible, uniqueTaskDiffFiles } from './useTaskDiffFiles'

const LEGACY_WORKSPACE_STATE = {
	workspaceBaseDirectory: '/workspace',
	repos: [
		{
			path: 'repo-a',
			sourceRef: 'main',
			branch: 'task-branch',
			primary: true,
		},
	],
}

describe('task diff eligibility', () => {
	test('allows project workspaces without legacy workspace state', () => {
		expect(isTaskDiffEligible('workspace-1', null)).toBe(true)
		expect(
			getTaskDiffEligibilityStatus({ taskId: 'task-1', workspaceId: 'workspace-1', workspaceState: null }),
		).toBe('ready')
	})

	test('continues to allow legacy workspaces with source refs', () => {
		expect(isTaskDiffEligible(null, LEGACY_WORKSPACE_STATE)).toBe(true)
	})

	test('rejects tasks without either workspace format', () => {
		expect(isTaskDiffEligible(null, null)).toBe(false)
		expect(getTaskDiffEligibilityStatus({ taskId: 'task-1', workspaceId: null, workspaceState: null })).toBe(
			'unavailable',
		)
	})
})

function file(path: string, updatedAt: string, repoId = 'repo-a', repoDisplayName?: string): TaskDiffFileRowType {
	return parseTaskDiffFileRow({
		id: `task-1:${repoId}:${path}`,
		taskId: 'task-1',
		repoId,
		repoDisplayName,
		sessionId: 'session-1',
		path,
		changeType: 'modified',
		additions: 1,
		deletions: 0,
		binary: false,
		generated: false,
		versionId: 'repo:path:hash',
		updatedAt,
	})
}

const EARLY = '2026-08-29T09:14:22.000Z'
const MID = '2026-08-29T10:02:47.000Z'
const LATE = '2026-08-29T11:41:05.000Z'

describe('uniqueTaskDiffFiles', () => {
	const path = 'apps/riptide-api/src/orpc/api/auth/admin/organizations-settings-set.effect.ts'
	const oldRow = file(path, EARLY, 'github.com--humanlayer--syncopate', 'syncopate')
	const currentRow = file(path, LATE, 'syncopate', 'syncopate')

	test('keeps the latest record for a display path, regardless of arrival order', () => {
		const other = file('src/other.ts', MID, 'syncopate', 'syncopate')
		for (const rows of [
			[oldRow, other, currentRow],
			[currentRow, other, oldRow],
		]) {
			const unique = uniqueTaskDiffFiles(rows)
			expect(unique).toHaveLength(2)
			expect(unique.find((row) => row.path === path)?.id).toBe(currentRow.id)
		}
	})

	test('uses the ID to break timestamp ties deterministically', () => {
		const sameTime = file(path, EARLY, 'syncopate', 'syncopate')
		const expected = [oldRow, sameTime].sort((left, right) => (left.id < right.id ? 1 : -1))[0]
		expect(uniqueTaskDiffFiles([oldRow, sameTime])[0]?.id).toBe(expected?.id)
		expect(uniqueTaskDiffFiles([sameTime, oldRow])[0]?.id).toBe(expected?.id)
	})

	test('does not collapse the same filename from repositories with different display paths', () => {
		const otherRepo = file(path, MID, 'other', 'other')
		expect(uniqueTaskDiffFiles([currentRow, otherRepo])).toHaveLength(2)
	})
})

describe('orderTaskDiffFiles', () => {
	test('orders by repo then path', () => {
		const rows = [file('src/b.ts', MID), file('src/a.ts', LATE), file('src/a.ts', MID, 'repo-b')]

		expect(orderTaskDiffFiles(rows, 'path').map((row) => `${row.repoId}/${row.path}`)).toEqual([
			'repo-a/src/a.ts',
			'repo-a/src/b.ts',
			'repo-b/src/a.ts',
		])
	})

	test('puts the latest change first and breaks capture ties by path', () => {
		const rows = [file('src/b.ts', MID), file('src/newest.ts', LATE), file('src/a.ts', MID)]

		expect(orderTaskDiffFiles(rows, 'recent').map((row) => row.path)).toEqual([
			'src/newest.ts',
			'src/a.ts',
			'src/b.ts',
		])
	})

	test('keeps a directory whole so the tree and the navigation walk one sequence', () => {
		const rows = [file('hooks/newest.ts', LATE), file('components/middle.tsx', MID), file('hooks/oldest.ts', EARLY)]

		// hooks leads because it holds the newest file, and its older file follows it
		// rather than being stranded after components/.
		expect(orderTaskDiffFiles(rows, 'recent').map((row) => row.path)).toEqual([
			'hooks/newest.ts',
			'hooks/oldest.ts',
			'components/middle.tsx',
		])
	})

	test('holds the frozen order while the agent writes to files already listed', () => {
		const frozen = rankTaskDiffFilesByRecency([file('src/a.ts', MID), file('src/b.ts', EARLY)]).map((row) => row.id)

		// b.ts was just rewritten and now carries the newest timestamp of the three.
		const rows = [file('src/a.ts', MID), file('src/b.ts', LATE)]

		expect(orderTaskDiffFiles(rows, 'recent', frozen).map((row) => row.path)).toEqual(['src/a.ts', 'src/b.ts'])
	})

	test('leads with files the agent added since the order was taken', () => {
		const frozen = [file('src/a.ts', MID), file('src/b.ts', EARLY)].map((row) => row.id)
		const rows = [
			file('src/a.ts', MID),
			file('src/b.ts', EARLY),
			file('src/fresh.ts', LATE),
			file('src/fresher.ts', LATE),
		]

		expect(orderTaskDiffFiles(rows, 'recent', frozen).map((row) => row.path)).toEqual([
			'src/fresh.ts',
			'src/fresher.ts',
			'src/a.ts',
			'src/b.ts',
		])
	})

	test('drops files that are gone and needs no frozen order to start', () => {
		const frozen = [file('src/gone.ts', LATE), file('src/a.ts', MID)].map((row) => row.id)

		expect(orderTaskDiffFiles([file('src/a.ts', MID)], 'recent', frozen).map((row) => row.path)).toEqual([
			'src/a.ts',
		])
		expect(orderTaskDiffFiles([file('src/a.ts', MID)], 'recent').map((row) => row.path)).toEqual(['src/a.ts'])
	})

	test('compares paths without a locale so every reader walks one order', () => {
		const rows = [file('src/B.ts', MID), file('src/a.ts', MID)]

		// A locale-aware compare would put a.ts first; byte order is the same everywhere.
		expect(orderTaskDiffFiles(rows, 'path').map((row) => row.path)).toEqual(['src/B.ts', 'src/a.ts'])
	})

	test('leaves the given rows untouched', () => {
		const rows = [file('src/b.ts', MID), file('src/a.ts', LATE)]

		orderTaskDiffFiles(rows, 'recent')

		expect(rows.map((row) => row.path)).toEqual(['src/b.ts', 'src/a.ts'])
	})
})
