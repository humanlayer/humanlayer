import type { DiffCommentAnchor } from '@humanlayer/db/zodschemas/diff-comment-anchor'
import { Schema } from 'effect'

export type CommentMutationResult = { readonly success: true; readonly transactionId: string }
export type CreatedCommentResult = CommentMutationResult & { readonly commentId: string }
export type DaemonReplyResult = CreatedCommentResult & { readonly parentCommentId: string }
export type ResolveCommentsResult = CommentMutationResult & { readonly resolvedCount: number }
export type DaemonBatchResult<Reason extends string> = Omit<CommentMutationResult, 'success'> & {
	readonly success: boolean
	readonly updated: ReadonlyArray<{ readonly truncatedId: string; readonly commentId: string }>
	readonly failed: ReadonlyArray<{ readonly truncatedId: string; readonly reason: Reason }>
}

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| ReadonlyArray<JsonValue>
	| { readonly [key: string]: JsonValue }

export const CommentUserInfoInput = Schema.Struct({
	organizationId: Schema.String,
	userId: Schema.String,
	createdByAgent: Schema.Boolean,
})
export interface CommentUserInfo extends Schema.Schema.Type<typeof CommentUserInfoInput> {}

export const CreateDiffCommentInput = Schema.Struct({
	id: Schema.optionalKey(Schema.String),
	taskId: Schema.String,
	contentText: Schema.String,
	contentJson: Schema.optionalKey(Schema.Json),
	anchor: Schema.Unknown,
	userInfo: CommentUserInfoInput,
})
export interface CreateDiffCommentInput extends Schema.Schema.Type<typeof CreateDiffCommentInput> {
	readonly anchor: DiffCommentAnchor
}
export const ReplyToDiffCommentInput = Schema.Struct({
	id: Schema.optionalKey(Schema.String),
	taskId: Schema.String,
	rootCommentId: Schema.String,
	contentText: Schema.String,
	contentJson: Schema.optionalKey(Schema.Json),
	userInfo: CommentUserInfoInput,
})
export interface ReplyToDiffCommentInput extends Schema.Schema.Type<typeof ReplyToDiffCommentInput> {}

export const EditDiffCommentInput = Schema.Struct({
	commentId: Schema.String,
	contentText: Schema.String,
	contentJson: Schema.optionalKey(Schema.Json),
	userInfo: CommentUserInfoInput,
})
export interface EditDiffCommentInput extends Schema.Schema.Type<typeof EditDiffCommentInput> {}

export const DeleteDiffCommentInput = Schema.Struct({ commentId: Schema.String, userInfo: CommentUserInfoInput })
export interface DeleteDiffCommentInput extends Schema.Schema.Type<typeof DeleteDiffCommentInput> {}

export const SetDiffCommentThreadResolvedInput = Schema.Struct({
	commentId: Schema.String,
	isResolved: Schema.Boolean,
	userInfo: CommentUserInfoInput,
})
export interface SetDiffCommentThreadResolvedInput extends Schema.Schema.Type<
	typeof SetDiffCommentThreadResolvedInput
> {}

export const ResolveDiffCommentsInput = Schema.Struct({
	taskId: Schema.String,
	rootCommentIds: Schema.Array(Schema.String),
	userInfo: CommentUserInfoInput,
})
export interface ResolveDiffCommentsInput extends Schema.Schema.Type<typeof ResolveDiffCommentsInput> {}

export const ListDiffCommentsForDaemonInput = Schema.Struct({
	taskId: Schema.String,
	includeResolved: Schema.Boolean,
	userInfo: CommentUserInfoInput,
})
export interface ListDiffCommentsForDaemonInput extends Schema.Schema.Type<typeof ListDiffCommentsForDaemonInput> {}

export const ReplyToDiffCommentForDaemonInput = Schema.Struct({
	taskId: Schema.String,
	truncatedCommentId: Schema.String,
	contentText: Schema.String,
	userInfo: CommentUserInfoInput,
})
export interface ReplyToDiffCommentForDaemonInput extends Schema.Schema.Type<typeof ReplyToDiffCommentForDaemonInput> {}

export const UpdateDiffCommentsForDaemonInput = Schema.Struct({
	taskId: Schema.String,
	truncatedCommentIds: Schema.Array(Schema.String),
	resolved: Schema.optionalKey(Schema.Boolean),
	deleted: Schema.optionalKey(Schema.Boolean),
	userInfo: CommentUserInfoInput,
})
export interface UpdateDiffCommentsForDaemonInput extends Schema.Schema.Type<typeof UpdateDiffCommentsForDaemonInput> {}
export type DaemonDiffComment = {
	readonly id: string
	readonly truncatedId: string
	readonly createdByUserId: string
	readonly createdByAgent: boolean
	readonly contentText: string
	readonly isDeleted: boolean
}
export type DiffCommentThreadList = {
	readonly comments: ReadonlyArray<{
		readonly root: DaemonDiffComment
		readonly replies: ReadonlyArray<DaemonDiffComment>
		readonly anchor: DiffCommentAnchor
		readonly isResolved: boolean
	}>
}
