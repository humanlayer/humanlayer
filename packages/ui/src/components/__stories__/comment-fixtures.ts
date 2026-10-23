import { userAuthoredCommentColumns } from '@humanlayer/db/artifact-comment-author'
import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'

export const mockUsers = {
	user1: { userId: 'user_abc1', displayName: 'Anna Chen', avatarUrl: 'https://github.com/evilrabbit.png' },
	user2: { userId: 'user_abc2', displayName: 'Bob Park', avatarUrl: 'https://github.com/shadcn.png' },
	user3: { userId: 'user_abc3', displayName: 'Carol Wu', avatarUrl: 'https://github.com/humanlayer.png' },
	user4: { userId: 'user_abc4', displayName: 'Dave Ito', avatarUrl: 'https://i.pravatar.cc/32?u=dave' },
	user5: { userId: 'user_abc5', displayName: 'Eve Smith', avatarUrl: 'https://i.pravatar.cc/32?u=eve' },
}

export function createMockComment(overrides: Partial<ArtifactComment> = {}): ArtifactComment {
	return {
		id: crypto.randomUUID(),
		organization_id: 'org_mock',
		resource_owner_user_id: 'user_abc1',
		task_id: 'task_mock',
		...userAuthoredCommentColumns('user_abc1'),
		reply_to_comment_id: null,
		created_at: BigInt(Date.now() - 300_000),
		updated_at: BigInt(Date.now() - 300_000),
		content_text: 'This needs to be updated.',
		content_json: null,
		artifact_id: 'artifact_mock',
		created_at_artifact_version_id: null,
		commented_upon_block_text: null,
		previous_block_text: null,
		next_block_text: null,
		anchor_json: null,
		kind: 'comment',
		is_resolved: false,
		resolved_by_user_id: null,
		is_deleted: false,
		created_by_agent: false,
		...overrides,
	}
}

// Pre-built fixtures for common scenarios
export const inlineComment = createMockComment({
	commented_upon_block_text: 'const result = await fetchData()',
	previous_block_text: '// Fetch data from API',
	next_block_text: 'return result',
})

export const spanlessComment = createMockComment({
	content_text: 'Overall this looks good, **nice work**! Consider using `useMemo` here though.',
})

export const replyComment = createMockComment({
	reply_to_comment_id: inlineComment.id,
	created_by_user_id: 'user_abc2',
	content_text: 'Agreed, fixing now.',
})

export const resolvedComment = createMockComment({
	is_resolved: true,
	resolved_by_user_id: 'user_abc2',
})

export const multilineHighlightComment = createMockComment({
	commented_upon_block_text: 'const result = await fetchData()\nconst parsed = JSON.parse(result)\nreturn parsed.items',
	previous_block_text: 'async function getData() {',
	next_block_text: '}',
	content_text: 'This whole block should be wrapped in a **try/catch** — `JSON.parse` can throw.',
})

export const outdatedComment = createMockComment({
	commented_upon_block_text: 'const oldCode = true',
	previous_block_text: null,
	next_block_text: null,
})

export const deletedComment = createMockComment({
	is_deleted: true,
})

export const agentCreatedComment = createMockComment({
	content_text: 'I noticed this function could benefit from better error handling. Consider wrapping the async call in a try/catch block.',
	created_by_agent: true,
})

export const agentReplyComment = createMockComment({
	reply_to_comment_id: inlineComment.id,
	content_text: 'Good catch! I\'ve updated the code to handle edge cases properly.',
	created_by_agent: true,
})

/** Build a participants array from mock user objects */
export function createParticipants(
	...users: (typeof mockUsers)[keyof typeof mockUsers][]
): Array<{ name: string; avatarUrl: string }> {
	return users.map((u) => ({ name: u.displayName, avatarUrl: u.avatarUrl }))
}

/** A root comment with multiple thread participants */
export const multiParticipantComment = createMockComment({
	commented_upon_block_text: 'const result = await fetchData()',
	previous_block_text: '// Fetch data from API',
	next_block_text: 'return result',
	content_text: 'Should we add error handling here?',
})

/** Replies for multi-participant thread */
export const multiParticipantReplies = [
	createMockComment({
		reply_to_comment_id: multiParticipantComment.id,
		created_by_user_id: mockUsers.user2.userId,
		content_text: 'Yes, we should wrap this in try/catch.',
	}),
	createMockComment({
		reply_to_comment_id: multiParticipantComment.id,
		created_by_user_id: mockUsers.user3.userId,
		content_text: 'Agreed, and add a fallback return value.',
	}),
]
