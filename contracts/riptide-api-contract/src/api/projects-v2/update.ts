import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { projectMutationFieldsSchema, projectV2Schema } from './schemas'

export const updateProjectV2Contract = contractBuilder
	.input(projectMutationFieldsSchema.partial().extend({ projectId: z.uuid() }))
	.output(z.object({ project: projectV2Schema }))
