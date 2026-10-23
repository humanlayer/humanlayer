import {
	parseTaskDiffFileBaselineRow,
	parseTaskDiffFileVersionRow,
	type TaskDiffFileBaselineRowType,
	type TaskDiffFileVersionRowType,
} from '@humanlayer/streams/diff'
import { describe, expect, test } from 'vitest'

import {
	getMissingReviewVersionIds,
	getTaskDiffAnchorComparison,
	getTaskDiffComparisons,
	withOmittedReasons,
} from '@/hooks/diffs/useTaskDiffComparisons'

const blob = (digit: string) => digit.repeat(40)
const updatedAt = '2026-09-25T00:00:00.000Z'

function baseline(fileKey: string, path: string, content: string | null, omitted = false): TaskDiffFileBaselineRowType {
	return parseTaskDiffFileBaselineRow({
		id: fileKey,
		fileKey,
		taskId: 'task-1',
		repoId: 'repo-1',
		path,
		content,
		byteLength: content?.length ?? 0,
		...(omitted ? { omittedReason: 'too_large' } : {}),
		updatedAt,
	})
}

function version(fileKey: string, digit: string, path: string, content: string | null): TaskDiffFileVersionRowType {
	return parseTaskDiffFileVersionRow({
		id: `${fileKey}:${blob(digit)}`,
		fileKey,
		blobId: blob(digit),
		taskId: 'task-1',
		repoId: 'repo-1',
		path,
		content,
		byteLength: content?.length ?? 0,
		updatedAt,
	})
}

function file(path: string, digit: string, overrides: { prevPath?: string; binary?: boolean } = {}) {
	const fileKey = `repo-1:${overrides.prevPath ?? path}`
	return {
		id: `task-1:repo-1:${path}`,
		repoId: 'repo-1',
		path,
		prevPath: overrides.prevPath,
		binary: overrides.binary ?? false,
		versionId: `${fileKey}:${blob(digit)}`,
	}
}

const versionOf = (fileKey: string, digit: string) => `${fileKey}:${blob(digit)}`

function maps(baselines: TaskDiffFileBaselineRowType[], versions: TaskDiffFileVersionRowType[]) {
	return {
		baselines: new Map(baselines.map((row) => [row.id, row])),
		versions: new Map(versions.map((row) => [row.id, row])),
	}
}

describe('getTaskDiffComparisons', () => {
	test('compares the current version with the file at task start', () => {
		const data = maps(
			[baseline('repo-1:a.ts', 'a.ts', 'A\n')],
			[version('repo-1:a.ts', 'b', 'a.ts', 'B\n'), version('repo-1:a.ts', 'c', 'a.ts', 'C\n')],
		)
		const { comparisons } = getTaskDiffComparisons([file('a.ts', 'c')], data)
		expect(comparisons).toEqual([
			{
				fileId: 'task-1:repo-1:a.ts',
				oldFile: { name: 'a.ts', contents: 'A\n', cacheKey: `baseline:repo-1:a.ts@${updatedAt}` },
				newFile: { name: 'a.ts', contents: 'C\n', cacheKey: `repo-1:a.ts:${blob('c')}` },
			},
		])
	})

	test('uses a null side for added and deleted files', () => {
		const data = maps(
			[baseline('repo-1:new.ts', 'new.ts', null), baseline('repo-1:gone.ts', 'gone.ts', 'bye\n')],
			[version('repo-1:new.ts', '1', 'new.ts', 'hi\n'), version('repo-1:gone.ts', '0', 'gone.ts', null)],
		)
		const { comparisons } = getTaskDiffComparisons([file('new.ts', '1'), file('gone.ts', '0')], data)
		expect(
			comparisons.map(({ oldFile, newFile }) => [oldFile?.contents ?? null, newFile?.contents ?? null]),
		).toEqual([
			[null, 'hi\n'],
			['bye\n', null],
		])
	})

	test('pairs a renamed file with its task-start path through the rename-stable key', () => {
		const data = maps(
			[baseline('repo-1:old.ts', 'old.ts', 'same\n')],
			[version('repo-1:old.ts', 'd', 'old.ts', 'same\nmore\n')],
		)
		const { comparisons } = getTaskDiffComparisons([file('new.ts', 'd', { prevPath: 'old.ts' })], data)
		expect(comparisons[0]?.oldFile?.name).toBe('old.ts')
		// The right side is named for where the file lives now, even if the version row predates the rename.
		expect(comparisons[0]?.newFile?.name).toBe('new.ts')
	})

	test('leaves files without rows loading, skips binary files, and reports omitted bodies', () => {
		const data = maps(
			[baseline('repo-1:big.ts', 'big.ts', null, true), baseline('repo-1:late.ts', 'late.ts', 'x\n')],
			[version('repo-1:big.ts', 'e', 'big.ts', 'small now\n')],
		)
		const result = getTaskDiffComparisons(
			[file('big.ts', 'e'), file('late.ts', 'f'), file('image.png', 'a', { binary: true })],
			data,
		)
		expect(result.comparisons).toEqual([])
		expect([...result.omittedFileIds]).toEqual(['task-1:repo-1:big.ts'])
		expect(withOmittedReasons([{ id: 'task-1:repo-1:big.ts' }, { id: 'other' }], result.omittedFileIds)).toEqual([
			{ id: 'task-1:repo-1:big.ts', omittedReason: 'too_large' },
			{ id: 'other' },
		])
	})
})

describe('getTaskDiffComparisons since last review', () => {
	const history = () =>
		maps(
			[baseline('repo-1:a.ts', 'a.ts', 'A\n')],
			[version('repo-1:a.ts', 'b', 'a.ts', 'B\n'), version('repo-1:a.ts', 'c', 'a.ts', 'C\n')],
		)

	test('compares the reviewed version B with the current version C', () => {
		const { comparisons } = getTaskDiffComparisons([file('a.ts', 'c')], history(), {
			comparison: 'since-last-review',
			reviewed: { 'repo-1:a.ts': { versionId: versionOf('repo-1:a.ts', 'b') } },
		})
		expect(comparisons[0]?.oldFile).toEqual({ name: 'a.ts', contents: 'B\n', cacheKey: `repo-1:a.ts:${blob('b')}` })
		expect(comparisons[0]?.newFile?.contents).toBe('C\n')
		// New comments record the reviewed version as their left side.
		expect(comparisons[0]?.sourceVersionId).toBe(versionOf('repo-1:a.ts', 'b'))
	})

	test('ignores review marks in since task start', () => {
		const { comparisons } = getTaskDiffComparisons([file('a.ts', 'c')], history(), {
			comparison: 'since-task-start',
			reviewed: { 'repo-1:a.ts': { versionId: versionOf('repo-1:a.ts', 'b') } },
		})
		expect(comparisons[0]?.oldFile?.contents).toBe('A\n')
	})

	test('starts from task start for unreviewed files', () => {
		const { comparisons } = getTaskDiffComparisons([file('a.ts', 'c')], history(), {
			comparison: 'since-last-review',
			reviewed: {},
		})
		expect(comparisons[0]?.oldFile?.contents).toBe('A\n')
	})

	test('compares a file reviewed at its current version with the version reviewed before it', () => {
		const { comparisons } = getTaskDiffComparisons([file('a.ts', 'c')], history(), {
			comparison: 'since-last-review',
			reviewed: {
				'repo-1:a.ts': {
					versionId: versionOf('repo-1:a.ts', 'c'),
					previousVersionId: versionOf('repo-1:a.ts', 'b'),
				},
			},
		})
		expect(comparisons[0]?.oldFile).toEqual({
			name: 'a.ts',
			contents: 'B\n',
			cacheKey: versionOf('repo-1:a.ts', 'b'),
		})
		expect(comparisons[0]?.newFile?.contents).toBe('C\n')
	})

	test('compares a file reviewed at its current version with task start when there was no earlier review', () => {
		const { comparisons } = getTaskDiffComparisons([file('a.ts', 'c')], history(), {
			comparison: 'since-last-review',
			reviewed: { 'repo-1:a.ts': { versionId: versionOf('repo-1:a.ts', 'c') } },
		})
		expect(comparisons[0]?.oldFile?.contents).toBe('A\n')
		expect(comparisons[0]?.newFile?.contents).toBe('C\n')
	})

	test('compares an unmarked file with the version approved before the unmarked one', () => {
		const { comparisons } = getTaskDiffComparisons([file('a.ts', 'c')], history(), {
			comparison: 'since-last-review',
			reviewed: {},
			unmarked: {
				'repo-1:a.ts': {
					versionId: versionOf('repo-1:a.ts', 'c'),
					previousVersionId: versionOf('repo-1:a.ts', 'b'),
				},
			},
		})
		expect(comparisons[0]?.oldFile?.contents).toBe('B\n')
		expect(comparisons[0]?.newFile?.contents).toBe('C\n')
	})

	test('never compares a file reverted to an approved version with itself', () => {
		const { comparisons } = getTaskDiffComparisons([file('a.ts', 'b')], history(), {
			comparison: 'since-last-review',
			reviewed: {},
			unmarked: {
				'repo-1:a.ts': {
					versionId: versionOf('repo-1:a.ts', 'c'),
					previousVersionId: versionOf('repo-1:a.ts', 'b'),
				},
			},
		})
		expect(comparisons[0]?.oldFile?.contents).toBe('A\n')
		expect(comparisons[0]?.newFile?.contents).toBe('B\n')
	})

	test('falls back to task start when the previously reviewed version is not in the stream', () => {
		const reviewed = {
			'repo-1:a.ts': {
				versionId: versionOf('repo-1:a.ts', 'c'),
				previousVersionId: versionOf('repo-1:a.ts', '9'),
			},
		}
		const data = history()
		const { comparisons } = getTaskDiffComparisons([file('a.ts', 'c')], data, {
			comparison: 'since-last-review',
			reviewed,
		})
		expect(comparisons[0]?.oldFile?.contents).toBe('A\n')
		expect(getMissingReviewVersionIds([reviewed], data.versions)).toEqual([versionOf('repo-1:a.ts', '9')])
	})

	test('compares a file changed since review with the reviewed version, not the one before it', () => {
		const data = maps(
			[baseline('repo-1:a.ts', 'a.ts', 'A\n')],
			[
				version('repo-1:a.ts', 'b', 'a.ts', 'B\n'),
				version('repo-1:a.ts', 'c', 'a.ts', 'C\n'),
				version('repo-1:a.ts', 'd', 'a.ts', 'D\n'),
			],
		)
		const { comparisons } = getTaskDiffComparisons([file('a.ts', 'd')], data, {
			comparison: 'since-last-review',
			reviewed: {
				'repo-1:a.ts': {
					versionId: versionOf('repo-1:a.ts', 'c'),
					previousVersionId: versionOf('repo-1:a.ts', 'b'),
				},
			},
		})
		expect(comparisons[0]?.oldFile?.contents).toBe('C\n')
		expect(comparisons[0]?.newFile?.contents).toBe('D\n')
	})

	test('keeps a mark across a detected rename and names each side for its own path', () => {
		const data = maps(
			[baseline('repo-1:old.ts', 'old.ts', 'A\n')],
			[version('repo-1:old.ts', 'b', 'old.ts', 'B\n'), version('repo-1:old.ts', 'c', 'new.ts', 'C\n')],
		)
		const { comparisons } = getTaskDiffComparisons([file('new.ts', 'c', { prevPath: 'old.ts' })], data, {
			comparison: 'since-last-review',
			reviewed: { 'repo-1:old.ts': { versionId: versionOf('repo-1:old.ts', 'b') } },
		})
		expect(comparisons[0]?.oldFile).toMatchObject({ name: 'old.ts', contents: 'B\n' })
		expect(comparisons[0]?.newFile).toMatchObject({ name: 'new.ts', contents: 'C\n' })
	})

	test('falls back to task start when the reviewed version is not in the stream', () => {
		const reviewed = { 'repo-1:a.ts': { versionId: versionOf('repo-1:a.ts', '9') } }
		const data = history()
		const { comparisons } = getTaskDiffComparisons([file('a.ts', 'c')], data, {
			comparison: 'since-last-review',
			reviewed,
		})
		expect(comparisons[0]?.oldFile?.contents).toBe('A\n')
		expect(getMissingReviewVersionIds([reviewed], data.versions)).toEqual([versionOf('repo-1:a.ts', '9')])
		expect(
			getMissingReviewVersionIds(
				[{ 'repo-1:a.ts': { versionId: versionOf('repo-1:a.ts', 'b') } }],
				data.versions,
			),
		).toEqual([])
	})
})

describe('getTaskDiffAnchorComparison', () => {
	test('rebuilds the comparison a comment was written on and drops versions that are gone', () => {
		const data = maps([baseline('repo-1:a.ts', 'a.ts', 'A\n')], [version('repo-1:a.ts', 'b', 'a.ts', 'B\n')])
		expect(
			getTaskDiffAnchorComparison({ patchHash: `repo-1:a.ts:${blob('b')}`, path: 'a.ts' }, data)?.newFile
				?.contents,
		).toBe('B\n')
		expect(getTaskDiffAnchorComparison({ patchHash: 'repo-1:a.ts:gone', path: 'a.ts' }, data)).toBeUndefined()
	})

	test('uses the saved left-side version, and task start when the anchor saved none', () => {
		const data = maps(
			[baseline('repo-1:a.ts', 'a.ts', 'A\n')],
			[version('repo-1:a.ts', 'b', 'a.ts', 'B\n'), version('repo-1:a.ts', 'c', 'a.ts', 'C\n')],
		)
		const patchHash = versionOf('repo-1:a.ts', 'c')
		const fromReview = getTaskDiffAnchorComparison(
			{ patchHash, sourceVersionId: versionOf('repo-1:a.ts', 'b'), path: 'a.ts' },
			data,
		)
		expect(fromReview?.oldFile?.contents).toBe('B\n')
		expect(fromReview?.sourceVersionId).toBe(versionOf('repo-1:a.ts', 'b'))
		const fromTaskStart = getTaskDiffAnchorComparison({ patchHash, path: 'a.ts' }, data)
		expect(fromTaskStart?.oldFile?.contents).toBe('A\n')
		expect(fromTaskStart?.sourceVersionId).toBeUndefined()
		expect(
			getTaskDiffAnchorComparison(
				{ patchHash, sourceVersionId: versionOf('repo-1:a.ts', '9'), path: 'a.ts' },
				data,
			),
		).toBeUndefined()
	})
})
