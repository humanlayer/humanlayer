import z from 'zod/v4'

/**
 * The typed review vocabulary for artifact comments. `comment` is free-form
 * feedback (the database default and every legacy/V1 row); `deletion` and
 * `approval` are the instant typed verdicts introduced by Artifact Viewer V2.
 *
 * This is the single source of truth shared by the database insert/update
 * schemas, the riptide API `comments.create` contract, and the Artifact Viewer
 * V2 UI (`CommentKind`) — the manual-sync pact is collapsed into one array so
 * the three layers cannot drift.
 */
export const COMMENT_KINDS = ['comment', 'deletion', 'approval'] as const

export const CommentKindSchema = z.enum(COMMENT_KINDS)

export type CommentKind = (typeof COMMENT_KINDS)[number]
