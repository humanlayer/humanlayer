import { AgentCommandSchema, AgentSkillSchema } from '@humanlayer/db/tables/agent-slash-commands'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const reportAgentCommandsContract = contractBuilder
	.input(
		z.object({
			hostId: z.string(),
			agent: z.string().default('claude'),
			workspacePath: z
				.string()
				.optional()
				.describe('Session cwd for a per-workspace report; omitted for the host-level report'),
			commands: z.array(AgentCommandSchema),
			skills: z.array(AgentSkillSchema),
			keepExistingCommands: z
				.boolean()
				.default(false)
				.describe(
					'Commands were read from disk only; keep the commands already stored, which the agent reported with plugins and built-ins',
				),
		}),
	)
	.output(z.object({ updated: z.boolean() }))
