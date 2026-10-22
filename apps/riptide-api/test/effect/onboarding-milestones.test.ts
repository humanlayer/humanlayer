import { describe, expect, it } from 'vitest'

import {
	isCrossUserHumanComment,
	isDesignReviewArtifact,
	isPlanningCollaborationComment,
} from '../../src/effects/services/onboarding/onboarding-milestones'

describe('isDesignReviewArtifact', () => {
	it('matches design discussions, PRDs, and TDDs by frontmatter type', () => {
		expect(isDesignReviewArtifact({ frontmatterType: 'design-discussion' })).toBe(true)
		expect(isDesignReviewArtifact({ frontmatterType: 'design-prd' })).toBe(true)
		expect(isDesignReviewArtifact({ frontmatterType: 'design-tdd' })).toBe(true)
	})

	it('falls back to the filename when frontmatter is absent', () => {
		expect(isDesignReviewArtifact({ fileName: '02-design-discussion-foo.md' })).toBe(true)
		expect(isDesignReviewArtifact({ fileName: '03-prd-foo.md' })).toBe(true)
		expect(isDesignReviewArtifact({ fileName: '04-tdd-foo.md' })).toBe(true)
	})

	it('rejects non-review artifacts', () => {
		expect(isDesignReviewArtifact({ frontmatterType: 'structure-outline' })).toBe(false)
		expect(isDesignReviewArtifact({ fileName: 'pr-description.md' })).toBe(false)
		expect(isDesignReviewArtifact({ fileName: 'notes.md' })).toBe(false)
		expect(isDesignReviewArtifact({})).toBe(false)
	})
})

describe('isCrossUserHumanComment', () => {
	it('counts a real teammate commenting on the owner’s doc', () => {
		expect(
			isCrossUserHumanComment({ createdByAgent: false, ownerUserId: 'owner', commenterUserId: 'teammate' }),
		).toBe(true)
	})

	it('ignores agent comments and self-comments', () => {
		expect(
			isCrossUserHumanComment({ createdByAgent: true, ownerUserId: 'owner', commenterUserId: 'teammate' }),
		).toBe(false)
		expect(isCrossUserHumanComment({ createdByAgent: false, ownerUserId: 'owner', commenterUserId: 'owner' })).toBe(
			false,
		)
	})
})

describe('isPlanningCollaborationComment', () => {
	it.each([
		{ frontmatterType: 'design-discussion' },
		{ frontmatterType: 'design-prd' },
		{ frontmatterType: 'design-tdd' },
		{ frontmatterType: 'structure-outline' },
		{ fileName: '02-design-discussion-legacy.md' },
		{ fileName: '03-prd-legacy.md' },
		{ fileName: '04-tdd-legacy.md' },
		{ fileName: '05-structure-outline-legacy.md' },
	])('counts another user or their agent on planning artifact $frontmatterType$fileName', (artifact) => {
		expect(
			isPlanningCollaborationComment({
				...artifact,
				ownerUserId: 'owner',
				commenterUserId: 'teammate',
			}),
		).toBe(true)
	})

	it('excludes the owner and non-planning artifacts', () => {
		expect(
			isPlanningCollaborationComment({
				frontmatterType: 'structure-outline',
				ownerUserId: 'owner',
				commenterUserId: 'owner',
			}),
		).toBe(false)
		expect(
			isPlanningCollaborationComment({
				frontmatterType: 'research',
				ownerUserId: 'owner',
				commenterUserId: 'teammate',
			}),
		).toBe(false)
	})

	it('does not broaden the email campaign human-only predicate', () => {
		expect(
			isCrossUserHumanComment({ createdByAgent: true, ownerUserId: 'owner', commenterUserId: 'teammate' }),
		).toBe(false)
	})
})
