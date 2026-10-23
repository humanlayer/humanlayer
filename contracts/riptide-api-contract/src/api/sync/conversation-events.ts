import { conversationEventSelectSchema } from '@humanlayer/db/tables/conversation-events'

import { contractBuilder } from '../../contract-builder'
import { createSyncOutputSchema, SyncInputSchema } from './shared-schemas'

export const syncConversationEventsContract = contractBuilder
	.input(SyncInputSchema)
	.output(createSyncOutputSchema(conversationEventSelectSchema))
