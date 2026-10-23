import {
	ProviderLoginMethodSchema,
	ProviderLoginProviderSchema,
	ProviderLoginStatusSchema,
} from '@humanlayer/db/tables/provider-login-requests'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ProviderLoginRequestViewSchema = z.object({
	id: z.uuid(),
	hostId: z.string(),
	provider: ProviderLoginProviderSchema,
	method: ProviderLoginMethodSchema,
	status: ProviderLoginStatusSchema,
	url: z.string().nullable(),
	userCode: z.string().nullable(),
	submittedCode: z.string().nullable(),
	error: z.string().nullable(),
	accountLabel: z.string().nullable(),
	expiresAt: z.number(),
	createdAt: z.number(),
	updatedAt: z.number(),
})
export type ProviderLoginRequestView = z.infer<typeof ProviderLoginRequestViewSchema>

export const createProviderLoginContract = contractBuilder
	.input(
		z.object({
			hostId: z.string().min(1),
			provider: ProviderLoginProviderSchema,
			method: ProviderLoginMethodSchema.optional(),
		}),
	)
	.output(z.object({ requestId: z.uuid(), transactionId: z.string() }))

export const submitProviderLoginCodeContract = contractBuilder
	.input(z.object({ requestId: z.uuid(), code: z.string().trim().min(1) }))
	.output(z.object({ transactionId: z.string() }))

export const cancelProviderLoginContract = contractBuilder
	.input(z.object({ requestId: z.uuid() }))
	.output(z.object({ transactionId: z.string() }))

export const listProviderLoginsContract = contractBuilder
	.input(z.object({ hostId: z.string().min(1).optional() }))
	.output(z.object({ requests: z.array(ProviderLoginRequestViewSchema) }))
