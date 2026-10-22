import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const PersonalAccessTokenSchema = z.object({
	id: z.string(),
	name: z.string(),
	obfuscatedValue: z.string(),
	createdAt: z.string(),
	expiresAt: z.string().nullable(),
	lastUsedAt: z.string().nullable(),
})

export const PersonalAccessTokenExpiryDaysSchema = z.union([
	z.literal(7),
	z.literal(14),
	z.literal(30),
	z.literal(60),
	z.literal(90),
])

export const CreatePersonalAccessTokenInputSchema = z.object({
	name: z.string().trim().min(1).max(100),
	expiresInDays: PersonalAccessTokenExpiryDaysSchema,
})

export type CreatePersonalAccessTokenInput = z.infer<typeof CreatePersonalAccessTokenInputSchema>

export const createPersonalAccessTokenContract = contractBuilder
	.input(CreatePersonalAccessTokenInputSchema)
	.output(z.object({ token: PersonalAccessTokenSchema, value: z.string() }))

export const listPersonalAccessTokensContract = contractBuilder
	.input(z.object({}).optional())
	.output(z.object({ tokens: z.array(PersonalAccessTokenSchema) }))

export const revokePersonalAccessTokenContract = contractBuilder
	.input(z.object({ id: z.string().min(1) }))
	.output(z.object({ success: z.literal(true) }))
