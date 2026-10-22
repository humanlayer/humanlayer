import { describe, expect, it } from 'vitest'

import { alertSnippet, alertTitle, isNewComment } from '@/minimalist/lib/comment-alerts'

const OPENED = 1_000_000

const comment = (over: Partial<Parameters<typeof alertTitle>[0]> = {}) => ({
	created_by_user_id: 'ada',
	created_by_agent: false,
	created_at: BigInt(OPENED + 10),
	reply_to_comment_id: null,
	...over,
})

const state = (over: Partial<Parameters<typeof isNewComment>[1]> = {}) => ({
	me: 'me',
	openedAt: OPENED,
	now: OPENED + 20,
	...over,
})

describe('isNewComment', () => {
	it('counts new comments from teammates and agents, your own agent too', () => {
		expect(isNewComment(comment(), state())).toBe(true)
		expect(isNewComment(comment({ created_by_user_id: 'me', created_by_agent: true }), state())).toBe(true)
	})

	it('skips comments you wrote', () => {
		expect(isNewComment(comment({ created_by_user_id: 'me' }), state())).toBe(false)
	})

	it('skips old comments syncing in, but not ones from just before the app opened', () => {
		const late = { created_at: BigInt(OPENED - 60_000) }
		expect(isNewComment(comment(late), state({ now: OPENED + 1_000 }))).toBe(false)
		expect(isNewComment(comment({ created_at: BigInt(OPENED - 2_000) }), state({ now: OPENED + 1_000 }))).toBe(true)
	})
})

describe('alertTitle', () => {
	it('names who wrote it, whether it is a reply, and the file', () => {
		const names = { me: 'me', name: 'Ada', file: 'plan.md' }
		expect(alertTitle(comment(), names)).toBe('Ada commented on plan.md')
		expect(alertTitle(comment({ created_by_agent: true, reply_to_comment_id: 'root' }), names)).toBe(
			"Ada's agent replied on plan.md",
		)
		expect(
			alertTitle(comment({ created_by_user_id: 'me', created_by_agent: true, reply_to_comment_id: 'root' }), {
				...names,
				file: 'app.ts',
			}),
		).toBe('The agent replied on app.ts')
	})
})

describe('alertSnippet', () => {
	it('flattens the text and trims long comments', () => {
		expect(alertSnippet('  Use a\n\nconstant  ')).toBe('Use a constant')
		const long = alertSnippet('x'.repeat(150))
		expect(long).toHaveLength(100)
		expect(long.endsWith('…')).toBe(true)
	})
})
