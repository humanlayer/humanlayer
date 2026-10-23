import z from 'zod/v4'

import { contractBuilder } from '../../../../contract-builder'

export const ArchiveAccessRequestInputSchema = z.object({ requestId: z.uuid() })

export const ArchiveAccessRequestOutputSchema = z.object({ ok: z.literal(true) })

export const archiveAccessRequestContract = contractBuilder
	.input(ArchiveAccessRequestInputSchema)
	.output(ArchiveAccessRequestOutputSchema)
