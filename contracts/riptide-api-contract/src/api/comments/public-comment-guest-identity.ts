import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const publicCommentGuestIdentityContract = contractBuilder
	.input(z.object({ commentId: z.uuid() }))
	.output(z.object({ name: z.string(), email: z.string().nullable(), unverified: z.literal(true) }))
