import { describe, expect, test } from 'vitest'

import {
	getTaskDiffReviewedIds,
	getTaskDiffSelectionFallback,
	getVisibleTaskDiffFiles,
} from '@/hooks/diffs/useTaskDiffFileVisibility'

const files = [
	{ id: 'a', repoId: 'repo-1', path: 'a.ts', versionId: 'hash-a' },
	{ id: 'b', repoId: 'repo-1', path: 'b.ts', versionId: 'hash-b' },
	{ id: 'c', repoId: 'repo-1', path: 'c.ts', versionId: 'hash-c' },
]

describe('task diff file visibility', () => {
	test('only treats matching versions as reviewed', () => {
		expect(
			getTaskDiffReviewedIds(files, {
				'repo-1:a.ts': { versionId: 'hash-a' },
				'repo-1:b.ts': { versionId: 'stale-hash' },
			}),
		).toEqual(new Set(['a']))
	})

	test('keeps a mark across a detected rename, keyed by the task-start path', () => {
		const renamed = [{ id: 'new', repoId: 'repo-1', path: 'new.ts', prevPath: 'a.ts', versionId: 'hash-a' }]
		expect(getTaskDiffReviewedIds(renamed, { 'repo-1:a.ts': { versionId: 'hash-a' } })).toEqual(new Set(['new']))
	})

	test('shows every file by default and filters reviewed files on demand', () => {
		const reviewedIds = new Set(['a', 'c'])
		expect(getVisibleTaskDiffFiles(files, reviewedIds, false, null)).toBe(files)
		expect(getVisibleTaskDiffFiles(files, reviewedIds, true, null)).toEqual([files[1]])
	})

	test('temporarily includes an explicitly revealed reviewed file', () => {
		expect(getVisibleTaskDiffFiles(files, new Set(['a']), true, 'a')).toEqual([files[0], files[1], files[2]])
	})

	test('moves selection forward, then backward, then clears it', () => {
		expect(getTaskDiffSelectionFallback(files, new Set(['b']), 'b')).toBe('c')
		expect(getTaskDiffSelectionFallback(files, new Set(['b', 'c']), 'c')).toBe('a')
		expect(getTaskDiffSelectionFallback(files, new Set(['a', 'b', 'c']), 'b')).toBeNull()
	})
})
