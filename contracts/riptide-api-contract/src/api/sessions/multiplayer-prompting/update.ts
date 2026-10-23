import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const MultiplayerPromptingDurationSchema = z.enum(['15m', '30m', '1h', '2h', '1d', 'unlimited'])
export type MultiplayerPromptingDuration = z.infer<typeof MultiplayerPromptingDurationSchema>

export const MultiplayerPromptingSettingsSchema = z.discriminatedUnion('enabled', [
	z.object({ enabled: z.literal(false) }),
	z.object({
		enabled: z.literal(true),
		addUserIds: z.array(z.string().min(1)).min(1).optional(),
		removeUserIds: z.array(z.string().min(1)).min(1).optional(),
		duration: MultiplayerPromptingDurationSchema.optional(),
	}),
])

export const UpdateMultiplayerPromptingInputSchema = z.object({
	sessionId: z.uuidv7(),
	settings: MultiplayerPromptingSettingsSchema,
})

export const UpdateMultiplayerPromptingOutputSchema = z.object({ transactionId: z.string() })

export const updateMultiplayerPromptingContract = contractBuilder
	.input(UpdateMultiplayerPromptingInputSchema)
	.output(UpdateMultiplayerPromptingOutputSchema)
