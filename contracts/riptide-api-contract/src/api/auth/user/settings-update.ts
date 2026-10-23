import { ExperimentFlagsSchema } from '@humanlayer/db/tables/user-settings'
import { ProjectsV2VariantSchema } from '@humanlayer/db/zodschemas/projects-v2-variant'
import { LaunchableCodingAgentZodSchema } from '@humanlayer/schemas/coding-agent'
import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { OrgSettingsResponseSchema } from '../../../types/sync'

const DefaultCodingAgentSchema = LaunchableCodingAgentZodSchema

export const UpdateUserSettingsInputSchema = z.object({
	theme: z.string().optional(),
	experimentalSubagentsEnabled: z.boolean().optional(),
	claudeCodeEffectRuntimeEnabled: z.boolean().optional(),
	haikuResearchSubagentsEnabled: z.boolean().optional(),
	defaultModel: z
		.string()
		.min(1)
		.max(100)
		.describe('A model id the host runtime accepts; the daemon rejects unknown ids at launch')
		.optional(),
	defaultAgent: DefaultCodingAgentSchema.optional(),
	preferBatchQueueDelivery: z
		.boolean()
		.optional()
		.describe('When true, deliver all queued messages at once; when false, deliver one per ready_for_input cycle'),
	sidebarVariant: z.enum(['flat', 'grouped']).optional(),
	showTaskPhaseLabels: z.boolean().optional(),
	projectsV2Enabled: z
		.boolean()
		.optional()
		.describe('true turns Projects V2 on for this organization; false is ignored because access never turns off'),
	projectsV2AssignedVariant: ProjectsV2VariantSchema.optional().describe(
		'The Projects V2 experiment group PostHog chose; saved only when no group is saved yet',
	),
	experiments: ExperimentFlagsSchema.optional().describe(
		'Merged into the stored flags; omitted keys are left unchanged',
	),
	onboardingDismissedAt: z.number().int().nonnegative().nullable().optional(),
})

export const UpdateUserSettingsOutputSchema = z.object({
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
		// EFFECTIVE — same org-AND-member resolution as settings.get; see that contract.
		commitTrackingEnabled: z.boolean(),
	}),
	jiraNeedsReauth: z.boolean(),
	jiraSiteUrl: z.httpUrl().nullable(), // http or https URLs only
})

export const updateUserSettingsContract = contractBuilder
	.input(UpdateUserSettingsInputSchema)
	.output(UpdateUserSettingsOutputSchema)
	.errors({
		FEATURE_DISABLED_BY_ORG: {
			status: StatusCodes.FORBIDDEN,
			data: z.object({ message: z.string() }),
		},
		SYNC_SETTINGS_ORG_POLICY_VIOLATION: {
			status: StatusCodes.BAD_REQUEST,
			data: z.object({ message: z.string() }),
		},
	})
