import { describe, it } from '@effect/vitest'
import {
	type PullRequestMutation,
	PullRequestMutationSchema,
} from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/mutate'
import { validate } from '@octokit/graphql-schema'
import { parse } from 'graphql'
import { expect } from 'vitest'

import {
	PULL_REQUEST_NODE_ID_QUERY,
	toMutationRequest,
} from '../../src/effects/services/github/procedures/mutate-pull-request'
import {
	PULL_REQUEST_PANEL_QUERY,
	PULL_REQUEST_REVIEW_THREADS_QUERY,
} from '../../src/effects/services/github/pull-requests/github-api'

const HEAD_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

/** One of every mutation the row can send, so each document is validated against GitHub. */
const MUTATIONS: readonly PullRequestMutation[] = [
	{ type: 'merge', method: 'SQUASH', expectedHeadSha: HEAD_SHA, commitHeadline: 'A title', commitBody: '* one' },
	{ type: 'enable_auto_merge', method: 'MERGE' },
	{ type: 'disable_auto_merge' },
	{ type: 'update_branch', expectedHeadSha: HEAD_SHA },
	{ type: 'ready_for_review' },
	{ type: 'convert_to_draft' },
	{ type: 'close' },
	{ type: 'reopen' },
]

const DOCUMENTS: ReadonlyArray<{ name: string; query: string }> = [
	{ name: 'PULL_REQUEST_PANEL_QUERY', query: PULL_REQUEST_PANEL_QUERY },
	{ name: 'PULL_REQUEST_REVIEW_THREADS_QUERY', query: PULL_REQUEST_REVIEW_THREADS_QUERY },
	{ name: 'PULL_REQUEST_NODE_ID_QUERY', query: PULL_REQUEST_NODE_ID_QUERY },
	...MUTATIONS.map((mutation) => ({
		name: `mutation.${mutation.type}`,
		query: toMutationRequest('PR_kwDOQB5GJc8AAAABCU4B6w', mutation).query,
	})),
]

describe('github graphql documents', () => {
	it('validates every mutation the row can send', () => {
		const declared = PullRequestMutationSchema.options.map((option) => option.shape.type.value)
		expect(MUTATIONS.map((mutation) => mutation.type).sort()).toEqual([...declared].sort())
	})

	it.each(DOCUMENTS)('$name parses as GraphQL', ({ query }) => {
		expect(() => parse(query)).not.toThrow()
	})

	it.each(DOCUMENTS)('$name is valid against the GitHub schema', ({ query }) => {
		expect(validate(query).map((error) => error.message)).toEqual([])
	})

	it('rejects a misspelled field, which is what makes the check above worth running', () => {
		const misspelled = PULL_REQUEST_PANEL_QUERY.replace('reviewDecision', 'reviewDecison')
		expect(misspelled).not.toEqual(PULL_REQUEST_PANEL_QUERY)
		expect(validate(misspelled).length).toBeGreaterThan(0)
	})

	it('rejects a syntax error, so the parse check above cannot quietly pass everything', () => {
		expect(() => parse('query Broken { repository(owner: "a" ')).toThrow()
	})
})
