import { accessRequestStatus } from '@humanlayer/db/tables/access-requests'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const ArtifactInfoInputSchema = z.object({ artifactId: z.uuid() })

export const ArtifactInfoOutputSchema = z.union([
	z.object({
		exists: z.literal(true),
		accessible: z.literal(true),
		requiresOrgSwitch: z.literal(false).optional(),
	}),
	z.object({
		exists: z.literal(true),
		accessible: z.literal(true),
		requiresOrgSwitch: z.literal(true),
		workosOrganizationId: z.string(),
		organizationName: z.string(),
	}),
	z.object({
		exists: z.literal(true),
		accessible: z.literal(false),
		organizationName: z.string(),
		domain: z.string().nullable(),
		// 'none' is the synthetic "no request yet" state; the rest derive from the db enum.
		myRequestStatus: z.enum(['none', ...accessRequestStatus.enumValues]),
		lastRequestedAt: z.iso.datetime().nullable(),
	}),
])

export const artifactInfoContract = contractBuilder.input(ArtifactInfoInputSchema).output(ArtifactInfoOutputSchema)
