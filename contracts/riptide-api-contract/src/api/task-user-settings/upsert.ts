import { taskUserSettingsSelectSchema } from '@humanlayer/db/tables/task-user-settings'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const UpsertTaskUserSettingsInputSchema = z.object({
	taskId: z.uuidv7().describe('The task ID to update'),
	workingDirectory: z.string().optional().describe('Per-user working directory override for this task'),
	hostId: z.string().optional().describe('Per-user host ID override for this task'),
	autoAdvanceQuestionsToResearch: z.boolean().optional().describe('Auto-advance from research-questions to research'),
	autoAdvanceResearchToDesign: z.boolean().optional().describe('Auto-advance from research to design-discussion'),
	autoAdvancePlanToWorktree: z.boolean().optional().describe('Auto-advance from plan to worktree setup'),
	autoAdvanceWorktreeToImplementation: z
		.boolean()
		.optional()
		.describe('Auto-advance from worktree setup to implementation'),
	autoAdvanceImplementationToPr: z
		.boolean()
		.optional()
		.describe('Auto-advance from implementation to PR description'),
})

export const UpsertTaskUserSettingsOutputSchema = z.object({
	transactionId: z.string(),
	settings: taskUserSettingsSelectSchema,
})

export const upsertTaskUserSettingsContract = contractBuilder
	.input(UpsertTaskUserSettingsInputSchema)
	.output(UpsertTaskUserSettingsOutputSchema)
