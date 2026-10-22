import type { ArtifactCommentAnchor } from '@humanlayer/db/zodschemas/artifact-comment-anchor'
import type { CommentKind } from '@humanlayer/db/zodschemas/artifact-comment-kind'
import { Schema } from 'effect'

import type {
	CommentMutationResult,
	CommentUserInfo,
	DaemonBatchResult,
	ResolveCommentsResult,
} from '../diff-comments/diff-comments-types'

export type { CommentMutationResult, CommentUserInfo, DaemonBatchResult, ResolveCommentsResult }
export type CreatedArtifactCommentResult = CommentMutationResult & { readonly commentId: string }
export type ArtifactDaemonReplyResult = CreatedArtifactCommentResult & { readonly parentCommentId: string }
export type ArtifactCommentPostCommitContext = {
	readonly ownerUserId: string
	readonly taskId: string
	readonly taskSlug: string | null
	readonly artifactId: string
	readonly artifactFileName: string
}
export type CreateArtifactCommentResult = CreatedArtifactCommentResult & {
	readonly postCommitContext: ArtifactCommentPostCommitContext
}
export type ResolveArtifactCommentsResult = ResolveCommentsResult & {
	readonly postCommitContext?: Pick<ArtifactCommentPostCommitContext, 'ownerUserId' | 'taskId' | 'artifactId'>
}

export const CommentUserInfoInput = Schema.Struct({
	organizationId: Schema.String,
	userId: Schema.String,
	createdByAgent: Schema.Boolean,
})

export const CreateArtifactCommentInput = Schema.Struct({
	id: Schema.optionalKey(Schema.String),
	artifactId: Schema.String,
	contentText: Schema.String,
	contentJson: Schema.optionalKey(Schema.Json),
	commentedUponBlockText: Schema.optionalKey(Schema.String),
	previousBlockText: Schema.optionalKey(Schema.NullOr(Schema.String)),
	nextBlockText: Schema.optionalKey(Schema.NullOr(Schema.String)),
	anchorJson: Schema.optionalKey(Schema.Unknown),
	kind: Schema.optionalKey(Schema.Unknown),
	replyToCommentId: Schema.optionalKey(Schema.String),
	userInfo: CommentUserInfoInput,
})
export interface CreateArtifactCommentInput extends Schema.Schema.Type<typeof CreateArtifactCommentInput> {
	readonly anchorJson?: ArtifactCommentAnchor
	readonly kind?: CommentKind
}
export const ListArtifactCommentsInput = Schema.Struct({
	taskId: Schema.String,
	artifactFilename: Schema.String,
	includeResolved: Schema.Boolean,
	userInfo: CommentUserInfoInput,
})
export interface ListArtifactCommentsInput extends Schema.Schema.Type<typeof ListArtifactCommentsInput> {}

export const ReplyToArtifactCommentInput = Schema.Struct({
	id: Schema.optionalKey(Schema.String),
	taskId: Schema.String,
	artifactFilename: Schema.String,
	truncatedCommentId: Schema.String,
	contentText: Schema.String,
	userInfo: CommentUserInfoInput,
})
export interface ReplyToArtifactCommentInput extends Schema.Schema.Type<typeof ReplyToArtifactCommentInput> {}

export const EditArtifactCommentInput = Schema.Struct({
	commentId: Schema.String,
	contentText: Schema.String,
	contentJson: Schema.optionalKey(Schema.Json),
	userInfo: CommentUserInfoInput,
})
export interface EditArtifactCommentInput extends Schema.Schema.Type<typeof EditArtifactCommentInput> {}

export const DeleteArtifactCommentInput = Schema.Struct({
	commentId: Schema.String,
	userInfo: CommentUserInfoInput,
})
export interface DeleteArtifactCommentInput extends Schema.Schema.Type<typeof DeleteArtifactCommentInput> {}

export const SetArtifactCommentThreadResolvedInput = Schema.Struct({
	commentId: Schema.String,
	isResolved: Schema.Boolean,
	userInfo: CommentUserInfoInput,
})
export interface SetArtifactCommentThreadResolvedInput extends Schema.Schema.Type<
	typeof SetArtifactCommentThreadResolvedInput
> {}

export const ResolveAllArtifactCommentsInput = Schema.Struct({
	artifactId: Schema.String,
	userInfo: CommentUserInfoInput,
})
export interface ResolveAllArtifactCommentsInput extends Schema.Schema.Type<typeof ResolveAllArtifactCommentsInput> {}

export const ResolveArtifactCommentsInput = Schema.Struct({
	artifactId: Schema.String,
	rootCommentIds: Schema.Array(Schema.String),
	userInfo: CommentUserInfoInput,
})
export interface ResolveArtifactCommentsInput extends Schema.Schema.Type<typeof ResolveArtifactCommentsInput> {}
export type ListArtifactCommentsForDaemonInput = ListArtifactCommentsInput
export type ReplyToArtifactCommentForDaemonInput = ReplyToArtifactCommentInput
export const UpdateArtifactCommentsForDaemonInput = Schema.Struct({
	taskId: Schema.String,
	artifactFilename: Schema.String,
	truncatedCommentIds: Schema.Array(Schema.String),
	resolved: Schema.optionalKey(Schema.Boolean),
	deleted: Schema.optionalKey(Schema.Boolean),
	userInfo: CommentUserInfoInput,
})
export interface UpdateArtifactCommentsForDaemonInput extends Schema.Schema.Type<
	typeof UpdateArtifactCommentsForDaemonInput
> {}
export type UpdateArtifactCommentsInput = UpdateArtifactCommentsForDaemonInput
export type ArtifactCommentProjection = {
	readonly id: string
	readonly truncatedId: string
	readonly userName: string
	readonly isResolved: boolean
	readonly createdByAgent: boolean
	readonly contentText: string
	readonly quotedText: string | null
	readonly previousBlockText: string | null
	readonly nextBlockText: string | null
	readonly replyToCommentId: string | null
}
export type ArtifactCommentsForUser = {
	readonly artifactFilename: string
	readonly comments: ReadonlyArray<ArtifactCommentProjection>
}
export type ArtifactCommentsForDaemon = ArtifactCommentsForUser
