import { expect, test } from 'vitest'

import { selectProjectSidebarTasks } from '@/components/project-sidebar/derive-project-sidebar'

test('fixed legacy Mine is owner OR any historical session creator, uncapped and independent of board scope', () => {
	const base = {
		name: 'task',
		archived: false,
		is_draft: false,
		resource_owner_user_id: 'me',
		workspace_id: null,
		created_at: 0n,
		updated_at: 0n,
	}
	const tasks = [
		...Array.from({ length: 25 }, (_, index) => ({ ...base, id: `owned${index}` })),
		{ ...base, id: 'historical', resource_owner_user_id: 'teammate' },
		{ ...base, id: 'unrelated', resource_owner_user_id: 'teammate' },
		{ ...base, id: 'creator-only', resource_owner_user_id: 'teammate', created_by: 'me' },
		{ ...base, id: 'draft', is_draft: true },
		{ ...base, id: 'archived', archived: true },
	]
	const history = [
		{ id: 's1', task_id: 'historical', created_by: 'me', archived: true, last_activity_at: 1n },
		{ id: 's2', task_id: 'unrelated', created_by: 'teammate', last_activity_at: 1n },
	]
	const result = selectProjectSidebarTasks(tasks, history, 'me')
	expect(result).toHaveLength(26)
	expect(result.map((task) => task.taskId)).toContain('historical')
	expect(result.map((task) => task.taskId)).not.toContain('creator-only')
	expect(result.map((task) => task.taskId)).not.toContain('unrelated')
	expect(result.map((task) => task.taskId)).not.toContain('draft')
	expect(result.map((task) => task.taskId)).not.toContain('archived')
	expect(result.find((task) => task.taskId === 'historical')?.allSessionIds).toEqual(['s1'])
})
