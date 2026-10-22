import * as z from 'zod'

export const ClaudeSettingsSchema = z
	.object({
		permissions: z
			.object({
				additionalDirectories: z.array(z.string()).optional(),
			})
			.optional(),
	})
	.passthrough()

export type ClaudeSettings = z.infer<typeof ClaudeSettingsSchema>

export function extractAdditionalDirectories(settings: ClaudeSettings): string[] {
	return settings.permissions?.additionalDirectories ?? []
}
