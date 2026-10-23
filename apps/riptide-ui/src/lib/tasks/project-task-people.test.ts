import { describe, expect, test } from 'vitest'

import type { OrgMember } from '@/hooks/useOrgMembers'
import { projectTaskSessionCreators } from '@/lib/tasks/project-task-people'

describe('projectTaskSessionCreators', () => {
	test('deduplicates active and archived session creators and omits the current owner', () => {
		const members = new Map<string, OrgMember>([
			['owner', { id: 'owner', email: 'owner@example.com' }],
			['creator', { id: 'creator', email: 'creator@example.com' }],
			['archived-creator', { id: 'archived-creator', email: 'archived@example.com' }],
		])

		const projected = projectTaskSessionCreators(
			'owner',
			[
				{ createdByUserId: 'owner' },
				{ createdByUserId: 'creator' },
				{ createdByUserId: 'creator' },
				{ createdByUserId: 'archived-creator' },
			],
			members,
		)

		expect(projected.map((member) => member.id)).toEqual(['creator', 'archived-creator'])
	})
})
