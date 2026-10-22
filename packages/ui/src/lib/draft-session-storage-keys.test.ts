import { describe, expect, test } from 'vitest'
import { draftSessionStorageKeys } from './draft-session-storage-keys'

describe('draftSessionStorageKeys', () => {
	test('newComment key format', () => {
		expect(draftSessionStorageKeys.newComment('artifact_123')).toBe('comment:new:artifact_123')
	})

	test('reply key format', () => {
		expect(draftSessionStorageKeys.reply('comment_456')).toBe('comment:reply:comment_456')
	})

	test('edit key format', () => {
		expect(draftSessionStorageKeys.edit('comment_789')).toBe('comment:edit:comment_789')
	})

	test('keys are independent across input types for the same id', () => {
		const id = 'same_id'
		const keys = new Set([
			draftSessionStorageKeys.newComment(id),
			draftSessionStorageKeys.reply(id),
			draftSessionStorageKeys.edit(id),
		])
		expect(keys.size).toBe(3)
	})

	test('diff root keys include task, repository, path, and independent range sides but not patch hash', () => {
		const key = draftSessionStorageKeys.diffCommentRoot({
			taskId: 'task:1',
			repoId: 'repo/one',
			path: 'src/a file.ts',
			start: { side: 'old', line: 3 },
			end: { side: 'new', line: 5 },
		})

		expect(key).toBe('diff-comment%3Anew:task%3A1:repo%2Fone:src%2Fa%20file.ts:old%3A3:new%3A5')
		expect(key).not.toContain('patch')
	})

	test('diff reply and edit keys use separate namespaces', () => {
		expect(draftSessionStorageKeys.diffCommentReply('root:1')).toBe('diff-comment:reply:root%3A1')
		expect(draftSessionStorageKeys.diffCommentEdit('comment:1')).toBe('diff-comment:edit:comment%3A1')
	})
})
