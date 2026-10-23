import { describe, expect, test } from 'vitest'

import type { ProjectedDiffThread } from './project-diff-comments'
import {
	buildCodeViewItems,
	createCodeViewItemVersionState,
	getComparisonDiff,
	getDiffLineCounts,
	type DiffReviewComparison,
	type DiffReviewCommentPlacement,
} from './build-code-view-items'

function comparison(fileId: string, name = 'a.ts'): DiffReviewComparison {
	return {
		fileId,
		oldFile: { name, contents: 'old\n', cacheKey: `${fileId}:old` },
		newFile: { name, contents: 'new\n', cacheKey: `${fileId}:new` },
	}
}

function thread(replies: readonly string[] = []): ProjectedDiffThread {
	const root = {
		id: 'root-1',
		created_at: 1n,
		updated_at: 1n,
		content_text: 'Root',
		content_json: null,
		anchor_json: {
			v: 1 as const,
			repoId: 'repo-1',
			path: 'a.ts',
			patchHash: 'patch-1',
			start: { side: 'new' as const, line: 1 },
			end: { side: 'new' as const, line: 1 },
		},
		is_resolved: false,
		is_deleted: false,
	} as ProjectedDiffThread['root']
	return {
		root,
		replies: replies.map((content, index) => ({
			...root,
			id: `reply-${index}`,
			reply_to_comment_id: root.id,
			anchor_json: null,
			content_text: content,
			created_at: BigInt(index + 2),
			updated_at: BigInt(index + 2),
		})),
		placement: { status: 'current', fileId: 'file-1', side: 'new', line: 1 },
	}
}

function placement(projectedThread: ProjectedDiffThread): DiffReviewCommentPlacement {
	return {
		annotationsByFile: new Map([['file-1', [{
			side: 'additions',
			lineNumber: 1,
			metadata: { kind: 'diff-comment-thread', thread: projectedThread },
		}]]]),
	}
}

describe('buildCodeViewItems', () => {
	test('replaces loading annotations with real diffs when comparisons arrive', () => {
		const files = [{ id: 'file-1', binary: false }]
		const versions = createCodeViewItemVersionState()
		const before = buildCodeViewItems(files, [], new Set(), {}, versions)[0]
		expect(before).toMatchObject({
			type: 'file',
			file: { contents: '' },
			annotations: [{ lineNumber: 0, metadata: { kind: 'diff-loading' } }],
		})
		const after = buildCodeViewItems(files, [comparison('file-1')], new Set(), {}, versions)[0]
		expect(after?.type).toBe('diff')
		expect(after?.version).not.toBe(before?.version)
		expect(after?.annotations).toEqual([])
	})

	test('shows a message instead of a skeleton when a body was omitted', () => {
		const items = buildCodeViewItems([{ id: 'big', binary: false, omittedReason: 'too_large' }], [comparison('big')])
		expect(items[0]).toMatchObject({
			type: 'file',
			file: { contents: 'This diff is too large to display.' },
			annotations: [],
		})
	})

	test('does not show skeletons for binary or collapsed files', () => {
		const items = buildCodeViewItems([
			{ id: 'binary', binary: true },
			{ id: 'collapsed', binary: false },
		], [], new Set(['collapsed']))
		expect(items[0]).toMatchObject({ file: { contents: 'Binary file cannot be displayed.' }, annotations: [] })
		expect(items[1]?.annotations).toBeUndefined()
	})

	test('adds comment-only placeholders without adding changed files', () => {
		const items = buildCodeViewItems([], [], new Set(), {
			missingFiles: [{
				id: 'missing:one',
				repoId: 'repo-1',
				path: 'removed.ts',
				threads: [],
				openRootCount: 1,
			}],
		})

		expect(items).toHaveLength(1)
		expect(items[0]).toMatchObject({
			id: 'missing:one',
			type: 'file',
			file: { name: 'repo-1/removed.ts', contents: '' },
			collapsed: false,
		})
	})

	test('changes the item version when a reply changes rendered thread data', () => {
		const files = [{ id: 'file-1', binary: false }]
		const comparisons = [comparison('file-1')]
		const versions = createCodeViewItemVersionState()
		const before = buildCodeViewItems(files, comparisons, new Set(), placement(thread()), versions)[0]
		const after = buildCodeViewItems(files, comparisons, new Set(), placement(thread(['Reply'])), versions)[0]

		expect(after?.version).not.toBe(before?.version)
	})

	test('changes the item version when a composer becomes a thread at the same annotation count', () => {
		const files = [{ id: 'file-1', binary: false }]
		const comparisons = [comparison('file-1')]
		const versions = createCodeViewItemVersionState()
		const composer: DiffReviewCommentPlacement = {
			annotationsByFile: new Map([['file-1', [{
				side: 'additions',
				lineNumber: 1,
				metadata: {
					kind: 'diff-comment-composer',
					fileId: 'file-1',
					repoId: 'repo-1',
					path: 'a.ts',
					patchHash: 'patch-1',
					range: { start: 1, end: 1, side: 'additions', endSide: 'additions' },
				},
			}]]]),
		}
		const before = buildCodeViewItems(files, comparisons, new Set(), composer, versions)[0]
		const after = buildCodeViewItems(files, comparisons, new Set(), placement(thread()), versions)[0]

		expect(after?.version).not.toBe(before?.version)
	})

	test('keeps unaffected file versions stable when another file comment changes', () => {
		const files = [
			{ id: 'file-1', binary: false },
			{ id: 'file-2', binary: false },
		]
		const comparisons = [comparison('file-1'), comparison('file-2', 'b.ts')]
		const versions = createCodeViewItemVersionState()
		const before = buildCodeViewItems(files, comparisons, new Set(), placement(thread()), versions)
		const after = buildCodeViewItems(files, comparisons, new Set(), placement(thread(['Reply'])), versions)

		expect(after[0]?.version).not.toBe(before[0]?.version)
		expect(after[1]?.version).toBe(before[1]?.version)
	})

	test('builds complete diffs whose unchanged lines stay expandable', () => {
		const oldLines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`)
		const newLines = oldLines.map((line, index) => (index === 19 ? 'changed line 20' : line))
		const items = buildCodeViewItems(
			[{ id: 'long', binary: false }],
			[{
				fileId: 'long',
				oldFile: { name: 'long.ts', contents: `${oldLines.join('\n')}\n`, cacheKey: 'long:old' },
				newFile: { name: 'long.ts', contents: `${newLines.join('\n')}\n`, cacheKey: 'long:new' },
			}],
		)
		const item = items[0]
		if (item?.type !== 'diff') throw new Error('Expected a diff item')
		expect(item.fileDiff.isPartial).toBe(false)
		expect(item.fileDiff.additionLines).toHaveLength(40)
		expect(item.fileDiff.deletionLines).toHaveLength(40)
		expect(getDiffLineCounts(item.fileDiff)).toEqual({ additions: 1, deletions: 1 })
	})

	test('renders added and deleted files from a missing side', () => {
		const added = getComparisonDiff({
			fileId: 'added',
			oldFile: null,
			newFile: { name: 'added.ts', contents: 'one\ntwo\n', cacheKey: 'added:new' },
		})
		const deleted = getComparisonDiff({
			fileId: 'deleted',
			oldFile: { name: 'deleted.ts', contents: 'gone\n', cacheKey: 'deleted:old' },
			newFile: null,
		})
		expect(added?.type).toBe('new')
		expect(added && getDiffLineCounts(added)).toEqual({ additions: 2, deletions: 0 })
		expect(deleted?.type).toBe('deleted')
		expect(deleted && getDiffLineCounts(deleted)).toEqual({ additions: 0, deletions: 1 })
		expect(getComparisonDiff({ fileId: 'none', oldFile: null, newFile: null })).toBeNull()
	})

	test('reuses a built diff for the same pair of cache keys', () => {
		expect(getComparisonDiff(comparison('cached'))).toBe(getComparisonDiff(comparison('cached')))
	})
})
