import { describe, expect, test } from 'vitest'

import {
	buildSidebarTasks,
	type SidebarSessionRow,
	type SidebarTaskRow,
} from '../../../src/components/sidebar-task-tree/useSidebarTaskTreeQuery'

// ---------------------------------------------------------------------------
// Minimal fixture builders — only supply the fields buildSidebarTasks reads
// ---------------------------------------------------------------------------

function makeTaskRow(id: string, overrides?: Partial<SidebarTaskRow>): SidebarTaskRow {
	return {
		taskId: id,
		taskName: `Task ${id}`,
		taskCreatedAt: null,
		taskUpdatedAt: null,
		ownerUserId: null,
		sessionCount: 0,
		latestSessionActivity: null,
		...overrides,
	}
}

function makeSessionRow(sessionId: string, taskId: string, overrides?: Partial<SidebarSessionRow>): SidebarSessionRow {
	return {
		sessionId,
		taskId,
		sessionName: `Session ${sessionId}`,
		sessionTitle: null,
		sessionStatus: 'idle',
		sessionCreatedAt: null,
		sessionLastActivityAt: null,
		messageCount: null,
		labels: [],
		...overrides,
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildSidebarTasks → task.isUnread derivation', () => {
	test('task is unread when one child session id is in the unread set', () => {
		const tasks = buildSidebarTasks(
			[makeTaskRow('t1')],
			[makeSessionRow('s1', 't1'), makeSessionRow('s2', 't1')],
			new Set(['s1']),
		)
		const t1 = tasks.find((t) => t.id === 't1')!
		expect(t1.isUnread).toBe(true)
	})

	test('task is unread when only one of multiple child sessions is in the unread set', () => {
		const tasks = buildSidebarTasks(
			[makeTaskRow('t1')],
			[makeSessionRow('s1', 't1'), makeSessionRow('s2', 't1'), makeSessionRow('s3', 't1')],
			new Set(['s2']),
		)
		const t1 = tasks.find((t) => t.id === 't1')!
		expect(t1.isUnread).toBe(true)
	})

	test('task is not unread when no child session id is in the unread set', () => {
		const tasks = buildSidebarTasks(
			[makeTaskRow('t1')],
			[makeSessionRow('s1', 't1'), makeSessionRow('s2', 't1')],
			new Set(['unrelated-session']),
		)
		const t1 = tasks.find((t) => t.id === 't1')!
		expect(t1.isUnread).toBe(false)
	})

	test('task with zero sessions is not unread', () => {
		const tasks = buildSidebarTasks(
			[makeTaskRow('t1')],
			[], // no session rows at all
			new Set(['anything']),
		)
		const t1 = tasks.find((t) => t.id === 't1')!
		expect(t1.isUnread).toBe(false)
	})

	test('draft sessions are excluded from task session rows', () => {
		const tasks = buildSidebarTasks(
			[makeTaskRow('t1', { sessionCount: 1 })],
			[makeSessionRow('draft-session', 't1', { sessionStatus: 'draft' })],
			new Set(['draft-session']),
		)
		const t1 = tasks.find((t) => t.id === 't1')!
		expect(t1.sessions).toEqual([])
		expect(t1.isUnread).toBe(false)
		expect(t1.status).toBeUndefined()
	})

	test('empty unread set leaves all tasks with isUnread false', () => {
		const tasks = buildSidebarTasks(
			[makeTaskRow('t1'), makeTaskRow('t2')],
			[makeSessionRow('s1', 't1'), makeSessionRow('s2', 't2')],
			new Set(),
		)
		expect(tasks.every((t) => t.isUnread === false)).toBe(true)
	})

	test('unread flag propagates only to the task whose child session is in the set', () => {
		const tasks = buildSidebarTasks(
			[makeTaskRow('t1'), makeTaskRow('t2')],
			[makeSessionRow('s1', 't1'), makeSessionRow('s2', 't2')],
			new Set(['s2']),
		)
		const t1 = tasks.find((t) => t.id === 't1')!
		const t2 = tasks.find((t) => t.id === 't2')!
		expect(t1.isUnread).toBe(false)
		expect(t2.isUnread).toBe(true)
	})

	test('sessions of other tasks never take a slot from a visible task', () => {
		const sessionRows = [
			makeSessionRow('other-1', 'other-task'),
			makeSessionRow('other-2', 'other-task'),
			makeSessionRow('other-3', 'other-task'),
			makeSessionRow('other-4', 'other-task'),
			makeSessionRow('other-5', 'other-task'),
			makeSessionRow('mine-1', 't1'),
		]
		const tasks = buildSidebarTasks([makeTaskRow('t1')], sessionRows, new Set())
		const t1 = tasks.find((t) => t.id === 't1')!
		expect(t1.sessions.map((s) => s.id)).toEqual(['mine-1'])
	})

	test('the cap keeps the first 5 activity-ordered rows of the task, not of the whole list', () => {
		const sessionRows = [
			makeSessionRow('newest', 't1'),
			makeSessionRow('foreign', 'other-task'),
			makeSessionRow('s2', 't1'),
			makeSessionRow('s3', 't1'),
			makeSessionRow('s4', 't1'),
			makeSessionRow('s5', 't1'),
			makeSessionRow('s6', 't1'),
		]
		const tasks = buildSidebarTasks([makeTaskRow('t1')], sessionRows, new Set())
		const t1 = tasks.find((t) => t.id === 't1')!
		expect(t1.sessions.map((s) => s.id)).toEqual(['newest', 's2', 's3', 's4', 's5'])
	})

	test('task activity and status come from that task only', () => {
		const sessionRows = [
			makeSessionRow('foreign', 'other-task', {
				sessionStatus: 'running',
				sessionLastActivityAt: 9_000n,
			}),
			makeSessionRow('mine', 't1', { sessionStatus: 'failed', sessionLastActivityAt: 1_000n }),
		]
		const tasks = buildSidebarTasks([makeTaskRow('t1')], sessionRows, new Set())
		const t1 = tasks.find((t) => t.id === 't1')!
		expect(t1.status).toBe('failed')
		expect(t1.sessions.map((s) => s.id)).toEqual(['mine'])
	})

	test('sessions capped at 5 per task — isUnread only reflects sessions within the cap', () => {
		// buildSidebarTasks slices sessions to 5 per task
		const sessionRows = [
			makeSessionRow('s1', 't1'),
			makeSessionRow('s2', 't1'),
			makeSessionRow('s3', 't1'),
			makeSessionRow('s4', 't1'),
			makeSessionRow('s5', 't1'),
			makeSessionRow('s6', 't1'), // 6th session — sliced off
		]
		// s6 is in the unread set but is beyond the cap, so task should NOT be unread
		const tasks = buildSidebarTasks([makeTaskRow('t1')], sessionRows, new Set(['s6']))
		const t1 = tasks.find((t) => t.id === 't1')!
		expect(t1.isUnread).toBe(false)
	})
})
