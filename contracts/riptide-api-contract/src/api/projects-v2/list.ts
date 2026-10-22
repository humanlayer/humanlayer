import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { projectV2Schema } from './schemas'

export const listProjectsV2Contract = contractBuilder
	.input(z.object({ archived: z.boolean().optional().default(false) }))
	.output(z.object({ projects: z.array(projectV2Schema) }))
