import { agentSlashCommandsSelectSchema } from '@humanlayer/db/tables/agent-slash-commands'

import { contractBuilder } from '../../../contract-builder'
import { createSyncOutputSchema, SyncInputSchema } from '../shared-schemas'

export const syncV2AgentSlashCommandsContract = contractBuilder
	.input(SyncInputSchema)
	.output(createSyncOutputSchema(agentSlashCommandsSelectSchema))
