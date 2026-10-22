import { describe, expect, test } from 'vitest'

import { countOpenCommentsByArtifact } from './useArtifactCommentCounts'

describe('countOpenCommentsByArtifact', () => {
	test('omits every member of a fully tombstoned thread from the query result', () => {
		const rows = [{ artifact_id: 'artifact-a' }]

		expect(countOpenCommentsByArtifact(rows, new Set(['artifact-a']))).toEqual({ 'artifact-a': 1 })
		expect(countOpenCommentsByArtifact([], new Set(['artifact-a']))).toEqual({})
	})

	test('keeps the existing raw-row count rule for active roots and replies', () => {
		expect(
			countOpenCommentsByArtifact(
				[{ artifact_id: 'artifact-a' }, { artifact_id: 'artifact-a' }, { artifact_id: 'other' }],
				new Set(['artifact-a']),
			),
		).toEqual({ 'artifact-a': 2 })
	})
})
