import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const ArtifactPublicPermissionSchema = z.enum(['off', 'view', 'comment'])

export const UpdateArtifactSharingInputSchema = z.union([
	z.object({ artifactId: z.uuidv7(), enabled: z.boolean(), permission: z.never().optional() }),
	z.object({ artifactId: z.uuidv7(), permission: ArtifactPublicPermissionSchema, enabled: z.never().optional() }),
])

export const UpdateArtifactSharingOutputSchema = z.object({
	transactionId: z.string(),
	shareKey: z.string().nullable(),
	permission: ArtifactPublicPermissionSchema,
})

export const updateArtifactSharingContract = contractBuilder
	.input(UpdateArtifactSharingInputSchema)
	.output(UpdateArtifactSharingOutputSchema)
	.errors({
		FEATURE_DISABLED_BY_ORG: {
			status: StatusCodes.FORBIDDEN,
			data: z.object({ message: z.string() }),
		},
	})
