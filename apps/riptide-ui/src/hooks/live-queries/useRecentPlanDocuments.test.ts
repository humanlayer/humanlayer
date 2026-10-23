import { describe, expect, test } from 'vitest'

import { type RecentPlanDocumentCandidate, selectRecentPlanDocuments } from './useRecentPlanDocuments'

function candidate(
	id: string,
	type: string,
	lastUpdatedAt: bigint,
	overrides: Partial<RecentPlanDocumentCandidate> = {},
): RecentPlanDocumentCandidate {
	return {
		id,
		taskId: `task-${id}`,
		fileName: `${id}.md`,
		frontmatter: { type },
		lastUpdatedAt,
		taskName: `Task ${id}`,
		resourceOwnerUserId: 'owner',
		shareEnabled: false,
		shareKey: null,
		...overrides,
	}
}

describe('selectRecentPlanDocuments', () => {
	test('classifies before taking three and accepts all planning types', () => {
		const documents = selectRecentPlanDocuments([
			candidate('log-1', 'research', 100n),
			candidate('log-2', 'ticket', 99n),
			candidate('discussion', 'design-discussion', 4n),
			candidate('prd', 'design-prd', 3n),
			candidate('tdd', 'design-tdd', 2n),
			candidate('outline', 'structure-outline', 1n),
		])

		expect(documents.map(({ id }) => id)).toEqual(['discussion', 'prd', 'tdd'])
	})

	test('uses descending id for timestamp ties and keeps documents without task labels', () => {
		const documents = selectRecentPlanDocuments([
			candidate('a', 'design-prd', 10n, { taskName: undefined }),
			candidate('c', 'design-prd', 10n),
			candidate('b', 'design-prd', 10n),
		])

		expect(documents.map(({ id }) => id)).toEqual(['c', 'b', 'a'])
		expect(documents[2]?.taskName).toBeUndefined()
	})

	test('accepts JSON-string frontmatter and omits metadata with no task identity', () => {
		const documents = selectRecentPlanDocuments([
			candidate('json', 'ignored', 2n, { frontmatter: JSON.stringify({ type: 'structure-outline' }) }),
			candidate('orphan', 'design-prd', 3n, { taskId: null }),
		])

		expect(documents.map(({ id }) => id)).toEqual(['json'])
	})
})
