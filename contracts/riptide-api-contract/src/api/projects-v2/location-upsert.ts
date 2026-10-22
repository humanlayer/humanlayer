import { ProjectRepositoryPathsSchema } from '@humanlayer/schemas/zod/project-workspace'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { projectLocationV2Schema } from './schemas'

export const upsertProjectV2LocationContract = contractBuilder
	.input(
		z.object({
			projectId: z.uuid(),
			hostId: z.string().min(1),
			repositoryPaths: ProjectRepositoryPathsSchema.describe(
				'Select supplied paths for this organization, user, host and repository across all projects. Each supplied path replaces the one configured location for that identity. Omitted identities are unchanged; an empty map is a no-op.',
			),
		}),
	)
	.output(z.object({ location: projectLocationV2Schema }))
