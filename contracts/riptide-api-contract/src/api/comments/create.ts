import { ArtifactCommentAnchorSchema } from '@humanlayer/db/zodschemas/artifact-comment-anchor'
import { CommentKindSchema } from '@humanlayer/db/zodschemas/artifact-comment-kind'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export { ArtifactCommentAnchorPointSchema as BlockPointSchema } from '@humanlayer/db/zodschemas/artifact-comment-anchor'

/**
 * Typed review vocabulary for `comments.create`: `comment` (free-form, the
 * default), `deletion`, or `approval`. Re-exported from the shared database
 * schema so the contract, database, and Artifact Viewer V2 UI stay in lockstep.
 */
export { CommentKindSchema } from '@humanlayer/db/zodschemas/artifact-comment-kind'

/**
 * Versioned Artifact Viewer V2 anchor envelope, persisted verbatim in
 * `artifact_comments.anchor_json`. `scope: 'block'` marks an anchor authored
 * as a whole-block target (offsets span the block); `scope: 'range'` is
 * reserved for precise text ranges. Rows without this envelope are legacy/V1
 * comments - the server never derives the legacy triplet columns from it, and
 * V1 callers that omit it are unchanged.
 */
export const AnchorV2Schema = ArtifactCommentAnchorSchema

export type AnchorV2Input = z.infer<typeof AnchorV2Schema>

export const CreateCommentInputSchema = z.object({
	id: z.uuidv7().optional().describe('Client-generated comment ID for optimistic inserts'),
	artifactId: z.uuid(),
	contentText: z.string().min(1),
	contentJson: z.unknown().optional(),
	/** Text content of the block being commented on */
	commentedUponBlockText: z.string().optional(),
	/** Text content of the block before the commented block (null if first block) */
	previousBlockText: z.string().nullable().optional(),
	/** Text content of the block after the commented block (null if last block) */
	nextBlockText: z.string().nullable().optional(),
	/**
	 * Artifact Viewer V2 anchor, persisted verbatim as `anchor_json`. Optional:
	 * V1 callers omit it. Providing it does NOT dual-write the legacy triplet.
	 */
	anchorJson: AnchorV2Schema.optional(),
	/**
	 * Typed review verdict. Optional and defaulted to `comment`: V1 callers omit
	 * it, and the server persists the validated value without inferring it from
	 * the body text.
	 */
	kind: CommentKindSchema.optional(),
	replyToCommentId: z.uuid().optional(),
})

export const CreateCommentOutputSchema = z.object({
	commentId: z.uuid(),
	transactionId: z.string(),
	success: z.boolean(),
})

export const createCommentContract = contractBuilder.input(CreateCommentInputSchema).output(CreateCommentOutputSchema)
