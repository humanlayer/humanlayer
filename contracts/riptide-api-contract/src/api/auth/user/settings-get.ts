import { ExperimentFlagsSchema } from '@humanlayer/db/tables/user-settings'
import { ProjectsV2VariantSchema } from '@humanlayer/db/zodschemas/projects-v2-variant'
import { LaunchableCodingAgentZodSchema } from '@humanlayer/schemas/coding-agent'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { OrgSettingsResponseSchema } from '../../../types/sync'

export const GetUserSettingsInputSchema = z.object({}).optional()
const DefaultCodingAgentSchema = LaunchableCodingAgentZodSchema

export const GetUserSettingsOutputSchema = z.object({
	effective: z.object({
		experimentalSubagentsEnabled: z.boolean(),
		claudeCodeEffectRuntimeEnabled: z.boolean(),
		haikuResearchSubagentsEnabled: z.boolean(),
		jiraEnabled: z.boolean(),
		linearEnabled: z.boolean(),
	}),
	userSettings: z.object({
		theme: z.string(),
		experimentalSubagentsEnabled: z.boolean(),
		claudeCodeEffectRuntimeEnabled: z.boolean(),
		haikuResearchSubagentsEnabled: z.boolean(),
		defaultModel: z.string(),
		defaultAgent: DefaultCodingAgentSchema,
		preferBatchQueueDelivery: z.boolean(),
		sidebarVariant: z.enum(['flat', 'grouped']),
		showTaskPhaseLabels: z.boolean(),
		projectsV2Enabled: z.boolean(),
		projectsV2AssignedVariant: ProjectsV2VariantSchema.nullable(),
		projectsV2AssignedAt: z.number().nullable(),
		experiments: ExperimentFlagsSchema,
		onboardingDismissedAt: z.number().nullable(),
		firstTaskCompletedAt: z.number().nullable(),
		firstStructuredWorkflowCompletedAt: z.number().nullable(),
		firstInboundCommentReceivedAt: z.number().nullable(),
	}),
	orgSettings: OrgSettingsResponseSchema.extend({
		haikuResearchSubagentsEnabled: z.boolean(),
		enableCreatingPubliclyShareableLinks: z.boolean(),
		// EFFECTIVE for the caller, despite living under `orgSettings`: the org's
		// `commit_tracking_enabled` AND this member's `user_settings.metrics_advanced_enabled`
		// (default true, an admin-set exclusion when false). An excluded member must read false.
		commitTrackingEnabled: z.boolean(),
	}),
	jiraNeedsReauth: z.boolean(),
	jiraSiteUrl: z.httpUrl().nullable(), // http or https URLs only
	linearNeedsReauth: z.boolean(),
})

export const getUserSettingsContract = contractBuilder
	.input(GetUserSettingsInputSchema)
	.output(GetUserSettingsOutputSchema)
