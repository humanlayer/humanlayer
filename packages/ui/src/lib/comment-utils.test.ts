import { describe, expect, test } from 'vitest'
import {
	formatAllThreadsForLlm,
	formatCommentForLlm,
	formatThreadForLlm,
	getTruncatedCommentId,
} from './comment-utils'

describe('getTruncatedCommentId', () => {
	test('extracts last segment from UUID', () => {
		expect(getTruncatedCommentId('550e8400-e29b-41d4-a716-446655440000')).toBe('446655440000')
	})

	test('returns full string if no dashes', () => {
		expect(getTruncatedCommentId('nodashes')).toBe('nodashes')
	})

	test('handles empty string', () => {
		expect(getTruncatedCommentId('')).toBe('')
	})
})

describe('formatCommentForLlm', () => {
	test('produces bare comment tag without filename', () => {
		const result = formatCommentForLlm({
			authorName: 'Alice',
			commentText: 'Test comment',
		})
		expect(result).toBe('<comment>\nAlice: Test comment\n</comment>')
	})

	test('wraps in comments tag with filename', () => {
		const result = formatCommentForLlm({
			artifactFilename: 'plan.md',
			authorName: 'Alice',
			commentText: 'Test comment',
		})
		expect(result).toContain('<comments for="plan.md">')
		expect(result).toContain('</comments>')
	})

	test('includes truncated comment ID', () => {
		const result = formatCommentForLlm({
			artifactFilename: 'plan.md',
			commentId: '550e8400-e29b-41d4-a716-446655440000',
			authorName: 'Alice',
			commentText: 'Test comment',
		})
		expect(result).toContain('<comment id="446655440000">')
	})

	test('includes resolved tag', () => {
		const result = formatCommentForLlm({
			authorName: 'Alice',
			commentText: 'Test comment',
			isResolved: true,
		})
		expect(result).toContain('Alice [RESOLVED]: Test comment')
	})
})

describe('formatThreadForLlm', () => {
	test('produces bare comment tag without filename', () => {
		const result = formatThreadForLlm({
			rootComment: {
				id: '550e8400-e29b-41d4-a716-446655440000',
				contentText: 'Root comment',
				createdByUserId: 'user1',
			},
			replies: [],
		})
		expect(result).toContain('<comment id="446655440000">')
		expect(result).not.toContain('<comments')
	})

	test('wraps in comments tag with filename', () => {
		const result = formatThreadForLlm({
			artifactFilename: 'plan.md',
			rootComment: {
				id: '550e8400-e29b-41d4-a716-446655440000',
				contentText: 'Root comment',
				createdByUserId: 'user1',
			},
			replies: [],
		})
		expect(result).toContain('<comments for="plan.md">')
		expect(result).toContain('</comments>')
	})

	test('indents replies', () => {
		const result = formatThreadForLlm({
			rootComment: {
				id: 'root-id',
				contentText: 'Root comment',
				createdByUserId: 'user1',
			},
			replies: [
				{
					id: 'reply-id',
					contentText: 'Reply text',
					createdByUserId: 'user2',
				},
			],
		})
		expect(result).toContain('  user2: Reply text')
	})
})

describe('formatAllThreadsForLlm', () => {
	test('formats multiple threads separated by blank lines', () => {
		const threads = [
			{
				rootComment: { id: 'id-1', contentText: 'First comment', createdByUserId: 'user1' },
				replies: [],
			},
			{
				rootComment: { id: 'id-2', contentText: 'Second comment', createdByUserId: 'user2' },
				replies: [{ id: 'reply-id', contentText: 'Reply', createdByUserId: 'user1' }],
			},
		]
		const userLookup = new Map([
			['user1', { displayName: 'Alice' }],
			['user2', { displayName: 'Bob' }],
		])

		const result = formatAllThreadsForLlm({ threads, userLookup })

		expect(result).toContain('Alice: First comment')
		expect(result).toContain('Bob: Second comment')
		expect(result).toContain('  Alice: Reply')
		// Two comment blocks separated by blank line
		expect(result.split('\n\n').length).toBeGreaterThanOrEqual(2)
	})

	test('uses for attribute instead of artifact', () => {
		const result = formatAllThreadsForLlm({
			artifactFilename: 'plan.md',
			threads: [
				{
					rootComment: {
						id: '550e8400-e29b-41d4-a716-446655440000',
						contentText: 'Thread 1',
						isResolved: false,
						createdByUserId: 'user1',
					},
					replies: [],
				},
			],
		})
		expect(result).toContain('<comments for="plan.md">')
		expect(result).not.toContain('artifact=')
	})

	test('includes comment IDs on each thread', () => {
		const result = formatAllThreadsForLlm({
			artifactFilename: 'plan.md',
			threads: [
				{
					rootComment: {
						id: '550e8400-e29b-41d4-a716-111111111111',
						contentText: 'Thread 1',
						isResolved: false,
						createdByUserId: 'user1',
					},
					replies: [],
				},
				{
					rootComment: {
						id: '550e8400-e29b-41d4-a716-222222222222',
						contentText: 'Thread 2',
						isResolved: false,
						createdByUserId: 'user2',
					},
					replies: [],
				},
			],
		})
		expect(result).toContain('<comment id="111111111111">')
		expect(result).toContain('<comment id="222222222222">')
	})

	test('returns empty string for empty threads array', () => {
		const result = formatAllThreadsForLlm({ threads: [] })
		expect(result).toBe('')
	})
})
