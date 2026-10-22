import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { projectV2Schema } from './schemas'

export const archiveProjectV2Contract = contractBuilder
	.input(z.object({ projectId: z.uuid(), archived: z.boolean().default(true) }))
	.output(z.object({ project: projectV2Schema }))
