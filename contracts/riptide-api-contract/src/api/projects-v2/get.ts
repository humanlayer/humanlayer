import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { projectLocationV2Schema, projectV2Schema } from './schemas'

export const getProjectV2Contract = contractBuilder
	.input(z.object({ projectId: z.uuid(), hostId: z.string().optional() }))
	.output(z.object({ project: projectV2Schema, location: projectLocationV2Schema.nullable() }))
