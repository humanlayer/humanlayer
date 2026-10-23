import { draftSessionStorageKeys } from '@humanlayer/ui/lib/draft-session-storage-keys'
import { beforeEach, describe, expect, it } from 'vitest'

import { diffLineDraftKey, draftedDiffLines, hasDraft } from './comment-drafts'

const file = { taskId: 'task', repoId: 'repo', path: 'src/a:b.ts' }

beforeEach(() => sessionStorage.clear())

describe('comment drafts', () => {
	it('uses the standard key for a one-line diff comment', () => {
		const point = { side: 'old' as const, line: 12 }
		expect(diffLineDraftKey(file, point)).toBe(
			draftSessionStorageKeys.diffCommentRoot({ ...file, start: point, end: point }),
		)
	})
	it("finds this file's drafted lines, skipping ranges and other files", () => {
		sessionStorage.setItem(diffLineDraftKey(file, { side: 'old', line: 12 }), '"a"')
		sessionStorage.setItem(diffLineDraftKey(file, { side: 'new', line: 3 }), '"b"')
		sessionStorage.setItem(
			draftSessionStorageKeys.diffCommentRoot({
				...file,
				start: { side: 'new', line: 4 },
				end: { side: 'new', line: 8 },
			}),
			'"range"',
		)
		sessionStorage.setItem(diffLineDraftKey({ ...file, path: 'src/a' }, { side: 'new', line: 1 }), '"other"')
		expect(draftedDiffLines(file)).toEqual(
			expect.arrayContaining([
				{ side: 'old', line: 12 },
				{ side: 'new', line: 3 },
			]),
		)
		expect(draftedDiffLines(file)).toHaveLength(2)
	})
	it('reports whether a key holds a draft', () => {
		expect(hasDraft('comment:reply:root')).toBe(false)
		sessionStorage.setItem('comment:reply:root', '"half a reply"')
		expect(hasDraft('comment:reply:root')).toBe(true)
	})
})
