import { ArtifactCommentAnchorSchema } from '@humanlayer/db/zodschemas/artifact-comment-anchor'
import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const PublicCommentGuestIdentitySchema = z.object({
	anonymousAuthorId: z.uuid(),
	guestName: z.string().trim().min(1).max(100),
	guestEmail: z.email().max(320).optional(),
})

/** A root comment needs an anchor; a reply names its thread with rootCommentId instead. */
export const CreatePublicArtifactCommentInputSchema = z
	.object({
		artifactId: z.uuid(),
		shareKey: z.string().min(1).max(512),
		id: z.uuidv7().optional(),
		contentText: z.string().trim().min(1).max(10_000),
		contentJson: z.unknown().optional(),
		anchorJson: ArtifactCommentAnchorSchema.optional(),
		rootCommentId: z.uuid().optional(),
		guestIdentity: PublicCommentGuestIdentitySchema,
	})
	.refine((input) => input.rootCommentId || input.anchorJson, {
		message: 'A root comment requires an anchor',
		path: ['anchorJson'],
	})

export const PublicArtifactCommentMutationOutputSchema = z.object({
	commentId: z.uuid(),
	transactionId: z.string(),
	success: z.literal(true),
	undoToken: z.string().optional(),
	undoExpiresAt: z.number().int().optional(),
})

export const createPublicArtifactCommentContract = contractBuilder
	.input(CreatePublicArtifactCommentInputSchema)
	.output(PublicArtifactCommentMutationOutputSchema)
	.errors({
		PUBLIC_COMMENT_RATE_LIMITED: {
			status: StatusCodes.TOO_MANY_REQUESTS,
			data: z.object({ message: z.string(), retryAfterSeconds: z.number().int().positive() }),
		},
		GUEST_IDENTITY_CONFLICT: {
			status: StatusCodes.CONFLICT,
			data: z.object({ message: z.string() }),
		},
	})
