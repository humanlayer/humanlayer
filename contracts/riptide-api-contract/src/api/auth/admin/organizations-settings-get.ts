import { DefaultTaskShareLevelSchema } from '@humanlayer/db/tables/organization-settings'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { SyncVersionSchema, SyncVisibilitySchema } from '../../../types/sync'

export const GetOrgSettingsInputSchema = z.object({}).optional()

export const GetOrgSettingsOutputSchema = z.object({
	experimentalSubagentsEnabled: z.boolean(),
	haikuResearchSubagentsEnabled: z.boolean(),
	jiraIntegrationEnabled: z.boolean(),
	linearIntegrationEnabled: z.boolean(),
	slackIntegrationEnabled: z.boolean(),
	githubIntegrationEnabled: z.boolean(),
	multiplayerPromptingEnabled: z.boolean(),
	defaultTaskShareLevel: DefaultTaskShareLevelSchema,
	/** @deprecated Always returns 2. */
	syncVersion: SyncVersionSchema,
	/** @deprecated Always returns 'v2'. */
	syncVisibility: SyncVisibilitySchema,
	enableCreatingPubliclyShareableLinks: z.boolean(),
	accessRequestsEnabled: z.boolean(),
	commitTrackingEnabled: z.boolean(),
	prTrackingEnabled: z.boolean(),
	advancedMetricsVisibleToAllMembers: z.boolean(),
})

export const getOrgSettingsContract = contractBuilder
	.input(GetOrgSettingsInputSchema)
	.output(GetOrgSettingsOutputSchema)
