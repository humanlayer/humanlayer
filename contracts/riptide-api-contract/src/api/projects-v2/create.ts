import { ProjectRepositoryPathsSchema } from '@humanlayer/schemas/zod/project-workspace'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { projectLocationV2Schema, projectMutationFieldsSchema, projectV2Schema } from './schemas'

export const createProjectV2Contract = contractBuilder
	.input(
		projectMutationFieldsSchema.extend({
			id: z.uuid().optional(),
			hostId: z.string().min(1).optional(),
			repositoryPaths: ProjectRepositoryPathsSchema.optional(),
		}),
	)
	.output(z.object({ project: projectV2Schema, location: projectLocationV2Schema.nullable() }))
