import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ArtifactVersionDescriptorSchema = z.object({
	kind: z.literal('archived'),
	id: z.uuid(),
	label: z.string(),
	versionNumber: z.number().int().positive(),
	contentHash: z.string(),
	createdAt: z.number().int().nonnegative(),
	createdBy: z.string(),
})

export const LatestArtifactVersionDescriptorSchema = z.object({
	kind: z.literal('latest'),
	id: z.literal('latest'),
	label: z.literal('Latest'),
	contentHash: z.string(),
	createdAt: z.number().int().nonnegative(),
})

export const ListArtifactVersionsInputSchema = z.object({ artifactId: z.uuid() })
export const ListArtifactVersionsOutputSchema = z.object({
	latest: LatestArtifactVersionDescriptorSchema,
	archived: z.array(ArtifactVersionDescriptorSchema),
})

export const GetArtifactVersionInputSchema = z.object({
	artifactId: z.uuid(),
	versionId: z.uuid(),
})
export const GetArtifactVersionOutputSchema = ArtifactVersionDescriptorSchema.extend({ content: z.string() })

export const listArtifactVersionsContract = contractBuilder
	.input(ListArtifactVersionsInputSchema)
	.output(ListArtifactVersionsOutputSchema)

export const getArtifactVersionContract = contractBuilder
	.input(GetArtifactVersionInputSchema)
	.output(GetArtifactVersionOutputSchema)
