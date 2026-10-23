import { describe, expect, test } from 'vitest'

import { type GroupableTask, groupTasksByWorkflow } from './groupTasksByWorkflow'

function session(labelName: string, lastActivityAt: number, archived = false) {
	return {
		archived,
		labels: [{ name: labelName, title: labelName.replace('rpi:', '') }],
		last_activity_at: BigInt(lastActivityAt),
	}
}

function task(id: string, sessions: GroupableTask['workflowSessions'] = [], is_draft = false): GroupableTask {
	return { id, is_draft, workflowSessions: sessions }
}

describe('groupTasksByWorkflow', () => {
	test('returns the five workflow groups, latest phase first', () => {
		const groups = groupTasksByWorkflow([])

		expect(groups.map((group) => group.id)).toEqual([
			'in-review',
			'implementation',
			'planning',
			'research-design',
			'todo',
		])
		expect(groups.map((group) => group.title)).toEqual([
			'In Review',
			'Implementation',
			'Planning',
			'Research & Design',
			'Todo / Draft',
		])
	})

	test('keeps empty groups so the header set does not change as tasks move', () => {
		const groups = groupTasksByWorkflow([task('a', [session('rpi:review', 100)])])

		expect(groups).toHaveLength(5)
		expect(groups.filter((group) => group.taskIds.length === 0)).toHaveLength(4)
	})

	test('places each task in the group matching its board column', () => {
		const groups = groupTasksByWorkflow([
			task('review', [session('rpi:review', 100)]),
			task('pr', [session('rpi:describe-pr', 100)]),
			task('impl', [session('rpi:implementation', 100)]),
			task('worktree', [session('rpi:worktree-setup', 100)]),
			task('plan', [session('rpi:plan', 100)]),
			task('structure', [session('rpi:structure', 100)]),
			task('research', [session('rpi:research', 100)]),
			task('design', [session('rpi:design-tdd', 100)]),
			task('todo', [session('rpi:todo', 100)]),
		])

		const byId = new Map(groups.map((group) => [group.id, group.taskIds]))
		expect(byId.get('in-review')).toEqual(['review', 'pr'])
		expect(byId.get('implementation')).toEqual(['impl', 'worktree'])
		expect(byId.get('planning')).toEqual(['plan', 'structure'])
		expect(byId.get('research-design')).toEqual(['research', 'design'])
		expect(byId.get('todo')).toEqual(['todo'])
	})

	test('preserves the input order within a group', () => {
		const groups = groupTasksByWorkflow([
			task('newest', [session('rpi:plan', 300)]),
			task('middle', [session('rpi:structure', 200)]),
			task('oldest', [session('rpi:plan', 100)]),
		])

		const planning = groups.find((group) => group.id === 'planning')
		expect(planning?.taskIds).toEqual(['newest', 'middle', 'oldest'])
	})

	test('lands drafts and session-less tasks in Todo / Draft', () => {
		const groups = groupTasksByWorkflow([task('draft', [], true), task('no-sessions', [])])

		const todo = groups.find((group) => group.id === 'todo')
		expect(todo?.taskIds).toEqual(['draft', 'no-sessions'])
	})

	test('ignores archived sessions when placing a task', () => {
		// The archived review session is the most recent, but must not pull the
		// task out of Research & Design.
		const groups = groupTasksByWorkflow([
			task('a', [session('rpi:research', 100), session('rpi:review', 999, true)]),
		])

		const research = groups.find((group) => group.id === 'research-design')
		expect(research?.taskIds).toEqual(['a'])
	})
})
