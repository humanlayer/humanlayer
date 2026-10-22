import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const ResolveSharedArtifactInputSchema = z.object({
	artifactId: z.uuid(),
	shareKey: z.string().min(1).optional(),
})

export const SharedArtifactResolutionSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('authenticated'),
		taskId: z.uuid(),
		artifactId: z.uuid(),
	}),
	z.object({
		kind: z.literal('switch_organization'),
		workosOrganizationId: z.string(),
		taskId: z.uuid(),
		artifactId: z.uuid(),
	}),
	z.object({
		kind: z.literal('public'),
		permission: z.enum(['view', 'comment']),
	}),
	z.object({ kind: z.literal('unavailable') }),
])

export type SharedArtifactResolution = z.infer<typeof SharedArtifactResolutionSchema>

export const resolveSharedArtifactContract = contractBuilder
	.input(ResolveSharedArtifactInputSchema)
	.output(SharedArtifactResolutionSchema)
