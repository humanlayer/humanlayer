import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const DaemonGetSettingsInputSchema = z.object({}).optional()

export const DaemonGetSettingsOutputSchema = z.object({
	experimentalSubagentsEnabled: z.boolean(),
	claudeCodeEffectRuntimeEnabled: z.boolean(),
	haikuResearchSubagentsEnabled: z.boolean(),
	jiraEnabled: z.boolean(),
	linearEnabled: z.boolean(),
	// Per-org telemetry-collection opt-ins (Advanced Metrics rollout). The daemon collects only
	// when these are true.
	commitTrackingEnabled: z.boolean(),
	prTrackingEnabled: z.boolean(),
})

export const daemonGetSettingsContract = contractBuilder
	.input(DaemonGetSettingsInputSchema)
	.output(DaemonGetSettingsOutputSchema)
