import { COMMENT_KINDS } from '@humanlayer/db/zodschemas/artifact-comment-kind'
import { describe, expect, it } from 'vitest'

import { APPROVE_ACTION, DELETE_ACTION, REVIEW_ACTIONS } from './review-actions'

describe('review action descriptors', () => {
	it('locks Delete semantics', () => {
		expect(DELETE_ACTION).toEqual({
			id: 'delete',
			hotkey: 'd',
			kind: 'deletion',
			contentText: 'Delete this',
			label: 'Delete',
		})
	})

	it('locks Approve semantics', () => {
		expect(APPROVE_ACTION).toEqual({
			id: 'approve',
			hotkey: 'a',
			kind: 'approval',
			contentText: 'Looks good',
			label: 'Approve',
		})
	})

	it('exposes exactly the two typed verdicts in toolbar order', () => {
		expect(REVIEW_ACTIONS.map((action) => action.id)).toEqual(['delete', 'approve'])
	})

	it('keeps the manual-sync pact with the shared comment-kind vocabulary', () => {
		// Every verdict kind must be part of the shared contract/database vocabulary.
		for (const action of REVIEW_ACTIONS) {
			expect(COMMENT_KINDS).toContain(action.kind)
		}
		// The free-form `comment` kind is not a typed verdict action.
		expect(REVIEW_ACTIONS.some((action) => action.kind === ('comment' as never))).toBe(false)
	})
})
