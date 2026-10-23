import { SyncVisibilitySchema } from '@humanlayer/db/tables/organization-settings'
import z from 'zod/v4'

// Re-export types and Zod schemas from db as the single source of truth
export type { SyncPathVersion, SyncVisibility } from '@humanlayer/db/tables/organization-settings'

import { type SyncPathVersion, SyncVersionSchema } from '@humanlayer/db/tables/organization-settings'
export { SyncVersionSchema, SyncVisibilitySchema }

// Alias for clarity in API contexts
export type SyncVersion = SyncPathVersion

/**
 * Shared schema for organization settings returned in user settings responses.
 * Used by settings-get and settings-update contracts.
 */
export const OrgSettingsResponseSchema = z.object({
	experimentalSubagentsEnabled: z.boolean(),
	jiraIntegrationEnabled: z.boolean(),
	linearIntegrationEnabled: z.boolean(),
	multiplayerPromptingEnabled: z.boolean(),
	syncVersion: SyncVersionSchema,
	syncVisibility: SyncVisibilitySchema,
})
