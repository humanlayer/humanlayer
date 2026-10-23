import { describe, expect, test } from 'vitest'

import { canReassignTaskOwner } from '@/lib/tasks/can-reassign-task-owner'

describe('task-detail owner reassignment permissions', () => {
	test.each([
		{ label: 'task owner', isOwner: true, role: null, roles: [], expected: true },
		{ label: 'singular admin role', isOwner: false, role: 'admin', roles: [], expected: true },
		{ label: 'plural admin roles', isOwner: false, role: null, roles: ['admin'], expected: true },
		{ label: 'editor role', isOwner: false, role: 'editor', roles: ['editor'], expected: false },
		{ label: 'ordinary member', isOwner: false, role: 'member', roles: ['member'], expected: false },
	])('$label: $expected', ({ isOwner, role, roles, expected }) => {
		expect(canReassignTaskOwner(isOwner, role, roles)).toBe(expected)
	})
})
