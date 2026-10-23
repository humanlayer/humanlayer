import type { DiffComment } from '@humanlayer/db/tables/diff-comments'
import { describe, expect, test } from 'vitest'

import type { DiffReviewComparison } from './build-code-view-items'
import { findFirstOverlappingDiffThread, projectDiffComments, type ProjectableDiffComment } from './project-diff-comments'

const lines = (overrides: Record<number, string>) =>
	`${Array.from({ length: 20 }, (_, index) => overrides[index + 1] ?? `line ${index + 1}`).join('\n')}\n`

// Line 11 changes from "old" to "new" in a 20-line file.
const comparisonFor = (fileId: string, name = 'src/a.ts'): DiffReviewComparison => ({
	fileId,
	oldFile: { name, contents: lines({ 10: 'keep', 11: 'old', 12: 'keep' }), cacheKey: `${fileId}:old` },
	newFile: { name, contents: lines({ 10: 'keep', 11: 'new', 12: 'keep' }), cacheKey: `${fileId}:new` },
})

function comment(overrides: Partial<DiffComment> = {}): ProjectableDiffComment {
	return {
		id: '00000000-0000-7000-8000-000000000001',
		organization_id: '00000000-0000-7000-8000-000000000010',
		resource_owner_user_id: 'user-1',
		task_id: '00000000-0000-7000-8000-000000000020',
		created_by_user_id: 'user-1',
		reply_to_comment_id: null,
		created_at: 1n,
		updated_at: 1n,
		content_text: 'Root',
		content_json: null,
		anchor_json: {
			v: 1,
			repoId: 'repo-1',
			path: 'src/a.ts',
			patchHash: 'patch-1',
			start: { side: 'old', line: 11 },
			end: { side: 'new', line: 11 },
		},
		is_resolved: false,
		resolved_by_user_id: null,
		is_deleted: false,
		created_by_agent: false,
		...overrides,
	}
}

const currentFile = {
	id: 'file-1',
	repoId: 'repo-1',
	path: 'src/a.ts',
	versionId: 'patch-1',
}

describe('projectDiffComments', () => {
	test('groups direct replies and places current cross-side ranges at their endpoint', () => {
		const root = comment()
		const reply = comment({
			id: '00000000-0000-7000-8000-000000000002',
			reply_to_comment_id: root.id,
			anchor_json: null,
			created_at: 2n,
			content_text: 'Reply',
		})
		const result = projectDiffComments({
			comments: [reply, root],
			files: [currentFile],
			comparisons: [comparisonFor('file-1')],
		})

		expect(result.threads).toHaveLength(1)
		expect(result.threads[0]?.replies).toEqual([reply])
		expect(result.threads[0]?.placement).toEqual({ status: 'current', fileId: 'file-1', side: 'new', line: 11 })
		expect(result.annotationsByFile.get('file-1')?.[0]).toMatchObject({ side: 'additions', lineNumber: 11 })
		expect(result.openRootCount).toBe(1)
	})

	test('separates outdated inline, file section, rename, pending, and missing placement', () => {
		const roots = [
			comment({ id: '00000000-0000-7000-8000-000000000001', anchor_json: { ...comment().anchor_json!, patchHash: 'old' } }),
			comment({ id: '00000000-0000-7000-8000-000000000002', anchor_json: { ...comment().anchor_json!, patchHash: 'old', end: { side: 'new', line: 99 } } }),
			comment({ id: '00000000-0000-7000-8000-000000000003', anchor_json: { ...comment().anchor_json!, path: 'src/old.ts', patchHash: 'old' } }),
			comment({ id: '00000000-0000-7000-8000-000000000004', anchor_json: { ...comment().anchor_json!, path: 'src/pending.ts' } }),
			comment({ id: '00000000-0000-7000-8000-000000000005', anchor_json: { ...comment().anchor_json!, path: 'src/missing.ts' } }),
		]
		const result = projectDiffComments({
			comments: roots,
			files: [
				{ ...currentFile, versionId: 'patch-2' },
				{ ...currentFile, id: 'renamed', path: 'src/new.ts', prevPath: 'src/old.ts', versionId: 'patch-2' },
				{ ...currentFile, id: 'pending', path: 'src/pending.ts', versionId: 'not-loaded' },
			],
			comparisons: [comparisonFor('file-1'), comparisonFor('renamed', 'src/new.ts')],
		})

		expect(result.threads.map((thread) => thread.placement.status)).toEqual([
			'outdated-inline',
			'outdated-file',
			'outdated-inline',
			'pending',
			'file-missing',
		])
		expect(result.fileSections.get('file-1')).toHaveLength(1)
		expect(result.fileSections.get('pending')).toHaveLength(1)
		expect(result.missingFiles[0]).toMatchObject({ repoId: 'repo-1', path: 'src/missing.ts' })
	})

	test('an old-side comment is outdated once the left side on screen differs from its source', () => {
		const oldSide = { start: { side: 'old' as const, line: 11 }, end: { side: 'old' as const, line: 11 } }
		const newSide = { start: { side: 'new' as const, line: 11 }, end: { side: 'new' as const, line: 11 } }
		const fromTaskStart = comment({ id: '00000000-0000-7000-8000-000000000001', anchor_json: { ...comment().anchor_json!, ...oldSide } })
		const fromReview = comment({
			id: '00000000-0000-7000-8000-000000000002',
			anchor_json: { ...comment().anchor_json!, ...oldSide, sourceVersionId: 'reviewed-1' },
		})
		const rightOnly = comment({
			id: '00000000-0000-7000-8000-000000000003',
			anchor_json: { ...comment().anchor_json!, ...newSide, sourceVersionId: 'reviewed-1' },
		})
		const comments = [fromTaskStart, fromReview, rightOnly]
		const statuses = (comparison: DiffReviewComparison) =>
			projectDiffComments({ comments, files: [currentFile], comparisons: [comparison] }).threads.map(
				(thread) => thread.placement.status,
			)

		// Task start on screen: an anchor without a source means task start.
		expect(statuses(comparisonFor('file-1'))).toEqual(['current', 'outdated-inline', 'current'])
		// The reviewed version on screen.
		expect(statuses({ ...comparisonFor('file-1'), sourceVersionId: 'reviewed-1' })).toEqual([
			'outdated-inline',
			'current',
			'current',
		])
	})

	test('keeps needed tombstones but does not count deleted or resolved roots as open', () => {
		const deletedRoot = comment({ is_deleted: true, content_text: 'secret' })
		const liveReply = comment({
			id: '00000000-0000-7000-8000-000000000002',
			reply_to_comment_id: deletedRoot.id,
			anchor_json: null,
			created_at: 2n,
		})
		const emptyDeletedRoot = comment({ id: '00000000-0000-7000-8000-000000000003', is_deleted: true })
		const resolvedRoot = comment({ id: '00000000-0000-7000-8000-000000000004', is_resolved: true })
		const result = projectDiffComments({
			comments: [deletedRoot, liveReply, emptyDeletedRoot, resolvedRoot],
			files: [currentFile],
			comparisons: [comparisonFor('file-1')],
		})

		expect(result.threads.map((thread) => thread.root.id)).toEqual([deletedRoot.id, resolvedRoot.id])
		expect(result.openRootCount).toBe(0)
	})

	test('finds the first stable inline thread whose anchor overlaps the selected lines', () => {
		const first = comment({
			id: '00000000-0000-7000-8000-000000000002',
			created_at: 2n,
			anchor_json: { ...comment().anchor_json!, start: { side: 'new', line: 10 }, end: { side: 'new', line: 12 } },
		})
		const earlier = comment({
			id: '00000000-0000-7000-8000-000000000001',
			created_at: 1n,
			anchor_json: { ...comment().anchor_json!, start: { side: 'new', line: 11 }, end: { side: 'new', line: 11 } },
		})
		const projected = projectDiffComments({
			comments: [first, earlier],
			files: [currentFile],
			comparisons: [comparisonFor('file-1')],
		})

		expect(findFirstOverlappingDiffThread(projected.threads, {
			id: 'file-1',
			range: { start: 11, end: 12, side: 'additions', endSide: 'additions' },
		})?.root.id).toBe(earlier.id)
		expect(findFirstOverlappingDiffThread(projected.threads, {
			id: 'file-1',
			range: { start: 11, end: 11, side: 'deletions', endSide: 'deletions' },
		})).toBeUndefined()
	})
})
