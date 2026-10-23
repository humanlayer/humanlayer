import z from 'zod/v4'

import { contractBuilder } from '../../../../contract-builder'

export const ListAccessRequestsInputSchema = z.object({
	status: z.enum(['pending', 'archived']),
})

export const AccessRequestListItemSchema = z.object({
	id: z.uuid(),
	requesterEmail: z.email(),
	requesterName: z.string().nullable(),
	artifactId: z.uuid().nullable(),
	artifactTitle: z.string(),
	taskName: z.string().nullable(),
	requestedAt: z.iso.datetime(),
	status: z.enum(['pending', 'invited', 'archived']),
	notificationStatus: z.enum(['not_started', 'scheduled', 'partial', 'failed', 'canceled']),
})

export const ListAccessRequestsOutputSchema = z.array(AccessRequestListItemSchema)

export const listAccessRequestsContract = contractBuilder
	.input(ListAccessRequestsInputSchema)
	.output(ListAccessRequestsOutputSchema)
