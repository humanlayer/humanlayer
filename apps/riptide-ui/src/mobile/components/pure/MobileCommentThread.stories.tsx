import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import type { Meta, StoryObj } from '@storybook/react'
import { MobileCommentThread, type MobileCommentUserInfo } from './MobileCommentThread'

const meta: Meta<typeof MobileCommentThread> = {
	title: 'Mobile/MobileCommentThread',
	component: MobileCommentThread,
	parameters: {
		layout: 'centered',
		viewport: { defaultViewport: 'mobile1' },
	},
}

export default meta

type Story = StoryObj<typeof MobileCommentThread>

// ----------------------------------------------------------------------------
// Data fixtures (not mock UI — plain ArtifactComment rows + user lookup)
// ----------------------------------------------------------------------------

const userLookup = new Map<string, MobileCommentUserInfo>([
	['user_anna', { displayName: 'Anna Chen', avatarUrl: 'https://github.com/evilrabbit.png' }],
	['user_bob', { displayName: 'Bob Park', avatarUrl: 'https://github.com/shadcn.png' }],
])

function makeComment(overrides: Partial<ArtifactComment> = {}): ArtifactComment {
	return {
		id: crypto.randomUUID(),
		organization_id: 'org_mock',
		resource_owner_user_id: 'user_anna',
		task_id: 'task_mock',
		created_by_user_id: 'user_anna',
		reply_to_comment_id: null,
		created_at: BigInt(Date.now() - 600_000),
		updated_at: BigInt(Date.now() - 600_000),
		content_text: 'This should probably handle the empty-list case.',
		content_json: null,
		artifact_id: 'artifact_mock',
		created_at_artifact_version_id: null,
		commented_upon_block_text: null,
		previous_block_text: null,
		next_block_text: null,
		kind: 'comment',
		is_resolved: false,
		resolved_by_user_id: null,
		is_deleted: false,
		created_by_agent: false,
		...overrides,
	}
}

const rootComment = makeComment({
	created_by_user_id: 'user_anna',
	commented_upon_block_text: 'const result = await fetchData()\nreturn result.items',
	content_text: 'Should we wrap this in a **try/catch**? `fetchData` can reject.',
})

const replies: ArtifactComment[] = [
	makeComment({
		reply_to_comment_id: rootComment.id,
		created_by_user_id: 'user_bob',
		created_at: BigInt(Date.now() - 120_000),
		content_text: 'Good call — adding it now.',
	}),
]

const noop = () => {}
const sharedArgs = {
	onReply: (parentId: string, text: string) => console.log('reply', parentId, text),
	onEdit: (id: string, text: string) => console.log('edit', id, text),
	onDelete: (id: string) => console.log('delete', id),
	userLookup,
}

// Own thread: currentUserId matches the root author → edit/delete visible in the name row.
export const OwnThread: Story = {
	args: {
		...sharedArgs,
		rootComment,
		replies,
		currentUserId: 'user_anna',
	},
}

// Someone else's thread: no edit/delete on the root (thread actions live in the drawer header).
export const OtherAuthorsThread: Story = {
	args: {
		...sharedArgs,
		rootComment,
		replies,
		currentUserId: 'user_bob',
	},
}

// Resolved root: shows the resolved marker (resolve/unresolve live in the drawer header).
export const Resolved: Story = {
	args: {
		...sharedArgs,
		rootComment: { ...rootComment, is_resolved: true, resolved_by_user_id: 'user_bob' },
		replies,
		currentUserId: 'user_anna',
	},
}

// List-mode presentation: the anchored block quote is shown for context and,
// with a jump handler, becomes a tap target that scrolls to the block.
export const WithAnchorContext: Story = {
	args: {
		...sharedArgs,
		rootComment,
		replies,
		currentUserId: 'user_anna',
		showAnchorContext: true,
		onJumpToBlock: () => console.log('jump to block'),
	},
}

// General (unanchored) comment with no replies yet.
export const GeneralNoReplies: Story = {
	args: {
		...sharedArgs,
		rootComment: makeComment({ commented_upon_block_text: null, content_text: 'Overall this reads well.' }),
		replies: [],
		currentUserId: 'user_anna',
		onReply: noop,
	},
}
