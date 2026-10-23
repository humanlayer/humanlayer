import { commentAuthorKey } from '@humanlayer/db/artifact-comment-author'
import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

import { partitionCommentRowsByRootFormat } from '../../lib/artifact-comment-format'
import { collectAnchorBlocks } from '../anchor/block-text-offsets'
import { parseAnchorV2, resolveAnchor, resolveApproximateAnchor } from '../anchor/resolve'
import type { AnchorPlacement, ApproximateAnchorHint, CommentKind } from '../anchor/types'
import type { CommentHighlightRange } from '../viewer/CommentHighlightExtension'
import { partitionThreadsByResolution } from './resolution'

export interface CommentProjectionIdentity {
	displayName?: string
	avatarUrl?: string
	isExternal?: boolean
	isUnverified?: boolean
}

/** Public-safe row surface consumed by the projection. Authenticated rows are structural supersets. */
export type ArtifactCommentProjectionRow = Omit<Pick<
	ArtifactComment,
	| 'id'
	| 'created_by_user_id'
	| 'reply_to_comment_id'
	| 'created_at'
	| 'updated_at'
	| 'content_text'
	| 'content_json'
	| 'artifact_id'
	| 'anchor_json'
	| 'kind'
	| 'is_resolved'
	| 'is_deleted'
	| 'created_by_agent'
>, 'created_by_user_id'> & {
	created_by_user_id: string | null
	anonymous_author_id?: string | null
	anonymous_guest_name?: string | null
	created_via_public_share?: boolean
}

export interface ProjectedCommentParticipant {
	userId: string
	name: string
	avatarUrl: string
}

/**
 * A resolved reply row, flattened under its V2 root, with presentation identity
 * baked in. Replies carry no anchor and produce no document decoration — their
 * visual/document context is the root's. `createdByAgent` distinguishes replies
 * authored through the daemon `reply_to_artifact_comment` tool.
 */
export interface ProjectedReply {
	id: string
	contentText: string
	contentJson: ArtifactComment['content_json']
	createdAt: bigint
	createdByUserId: string
	createdByAgent: boolean
	authorName: string
	authorAvatarUrl: string | null
	isUnverified?: boolean
	createdViaPublicShare?: boolean
}

export interface ProjectedCommentThread {
	root: ArtifactCommentProjectionRow
	replies: ProjectedReply[]
	authorName: string
	authorAvatarUrl: string | null
	isUnverified?: boolean
	participants: ProjectedCommentParticipant[]
	placement: AnchorPlacement
	/**
	 * Best-effort location from surviving neighbor blocks, only for an Outdated
	 * placement. Placement stays `outdated`; this never becomes a highlight.
	 */
	approximate?: ApproximateAnchorHint | null
}

export interface ArtifactCommentProjection {
	/** Open (unresolved) threads, in document order — the only highlight source. */
	threads: ProjectedCommentThread[]
	/**
	 * Resolved threads from the SAME one-pass row snapshot, kept available to the
	 * rail's Resolved and All filters without a second partition pass. Resolved
	 * roots never emit highlights and are absent from {@link rootIds}.
	 */
	resolvedThreads: ProjectedCommentThread[]
	highlights: CommentHighlightRange[]
	rootIds: ReadonlySet<string>
}

/** Project one synced row snapshot into all open-review document meaning. */
export function projectArtifactComments(
	rows: ArtifactCommentProjectionRow[],
	doc: ProseMirrorNode,
	identities: ReadonlyMap<string, CommentProjectionIdentity>,
): ArtifactCommentProjection {
	const { v2 } = partitionCommentRowsByRootFormat(rows)
	const anchorBlocks = collectAnchorBlocks(doc)
	const repliesByRoot = new Map<string, ArtifactCommentProjectionRow[]>()
	const v2ById = new Map(v2.map((row) => [row.id, row]))

	for (const row of v2) {
		if (!row.reply_to_comment_id || row.is_deleted) continue
		const rootId = findRootId(row, v2ById)
		if (!rootId) continue
		const replies = repliesByRoot.get(rootId)
		if (replies) replies.push(row)
		else repliesByRoot.set(rootId, [row])
	}

	// Resolve every eligible root once (open AND resolved), then partition in one
	// pass. Only open roots go on to emit highlights and populate `rootIds`;
	// resolved roots stay available to the rail via `resolvedThreads`.
	const allThreads: ProjectedCommentThread[] = []
	for (const root of v2) {
		if (root.reply_to_comment_id) continue
		const rawReplies = (repliesByRoot.get(root.id) ?? []).sort(compareCreatedAt)
		if (root.is_deleted && rawReplies.length === 0) continue
		const participants = [
			...new Map(
				[root, ...rawReplies].map((row) => [commentAuthorKey(row), row]),
			).values(),
		]
		const author = identityFor(root, identities)
		const anchor = parseAnchorV2(root.anchor_json)
		const placement: AnchorPlacement = anchor ? resolveAnchor(anchorBlocks, anchor) : { status: 'outdated' }
		allThreads.push({
			root: root.is_deleted ? { ...root, content_text: 'Comment deleted' } : root,
			replies: rawReplies.map((reply) => resolveReply(reply, identities)),
			authorName: author?.displayName ?? (root.created_by_agent ? 'Agent' : 'Unknown'),
			authorAvatarUrl: author?.avatarUrl ?? null,
			isUnverified: author?.isUnverified === true,
			participants: participants.map((row) => {
				const userId = commentAuthorKey(row)
				const identity = identityFor(row, identities)
				return {
					userId,
					name: identity?.displayName ?? 'Unknown',
					avatarUrl: identity?.avatarUrl ?? '',
				}
			}),
			placement,
			approximate:
				anchor && placement.status === 'outdated' ? resolveApproximateAnchor(anchorBlocks, anchor) : null,
		})
	}

	const { open, resolved } = partitionThreadsByResolution(allThreads)
	open.sort(compareThreads)
	resolved.sort(compareThreads)

	const highlights: CommentHighlightRange[] = []
	for (const thread of open) {
		if (thread.placement.status !== 'resolved') continue
		highlights.push({
			rootCommentId: thread.root.id,
			from: thread.placement.from,
			to: thread.placement.to,
			createdAt: Number(thread.root.created_at),
			kind: normalizeCommentKind(thread.root.kind),
		})
	}

	return {
		threads: open,
		resolvedThreads: resolved,
		highlights,
		rootIds: new Set(open.map((thread) => thread.root.id)),
	}
}

/** Resolve one reply row's presentation identity from the author map. Agent
 *  replies fall back to an "Agent" label when their user id is not a member. */
function resolveReply(
	reply: ArtifactCommentProjectionRow,
	identities: ReadonlyMap<string, CommentProjectionIdentity>,
): ProjectedReply {
	const identity = identityFor(reply, identities)
	return {
		id: reply.id,
		contentText: reply.content_text,
		contentJson: reply.content_json,
		createdAt: reply.created_at,
		createdByUserId: commentAuthorKey(reply),
		createdByAgent: reply.created_by_agent,
		authorName: identity?.displayName ?? (reply.created_by_agent ? 'Agent' : 'Unknown'),
		authorAvatarUrl: identity?.avatarUrl ?? null,
		isUnverified: identity?.isUnverified === true,
		createdViaPublicShare: reply.created_via_public_share === true,
	}
}

function identityFor(
	row: ArtifactCommentProjectionRow,
	identities: ReadonlyMap<string, CommentProjectionIdentity>,
): CommentProjectionIdentity | undefined {
	if (row.created_by_user_id) return identities.get(row.created_by_user_id)
	if (row.anonymous_guest_name) return { displayName: row.anonymous_guest_name, isUnverified: true }
	return undefined
}

/** Coerce the persisted `kind` text column into the typed vocabulary. */
function normalizeCommentKind(kind: string | null | undefined): CommentKind {
	return kind === 'deletion' || kind === 'approval' ? kind : 'comment'
}

function findRootId(
	row: ArtifactCommentProjectionRow,
	byId: ReadonlyMap<string, ArtifactCommentProjectionRow>,
): string | null {
	let parentId = row.reply_to_comment_id
	const seen = new Set([row.id])
	while (parentId) {
		const parent = byId.get(parentId)
		if (!parent || seen.has(parent.id)) return null
		if (!parent.reply_to_comment_id) return parent.id
		seen.add(parent.id)
		parentId = parent.reply_to_comment_id
	}
	return null
}

function compareCreatedAt(a: ArtifactCommentProjectionRow, b: ArtifactCommentProjectionRow): number {
	return Number(a.created_at - b.created_at) || a.id.localeCompare(b.id)
}

/**
 * Rail order: located threads by current document position (then creation),
 * followed by Outdated threads by creation time.
 */
export function compareThreads(a: ProjectedCommentThread, b: ProjectedCommentThread): number {
	if (a.placement.status === 'resolved' && b.placement.status === 'resolved') {
		return a.placement.from - b.placement.from || compareCreatedAt(a.root, b.root)
	}
	if (a.placement.status === 'resolved') return -1
	if (b.placement.status === 'resolved') return 1
	return compareCreatedAt(a.root, b.root)
}
