import { describe, expect, test } from 'vitest'

import { resolveTaskOwnerDisplay } from '@/hooks/task-detail/useTaskOwnerDisplay'

describe('task detail owner display', () => {
	test('uses the existing eight-character ID fallback when the owner cannot be resolved', () => {
		expect(resolveTaskOwnerDisplay('01910c93-7b8a-7ef1-8000-000000000001')).toEqual({
			ownerFullName: '01910c93',
			ownerInitials: '?',
		})
	})

	test('uses member identity when the owner can be resolved', () => {
		expect(
			resolveTaskOwnerDisplay('user-owner', {
				id: 'user-owner',
				email: 'owner@example.com',
				firstName: 'Task',
				lastName: 'Owner',
			}),
		).toEqual({ ownerFullName: 'Task Owner', ownerInitials: 'TO' })
	})
})
