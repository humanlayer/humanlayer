import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { GitHubRepositorySchema } from './schemas'

export const listGitHubRepositoriesContract = contractBuilder
	.input(z.object({ connectionId: z.uuid() }))
	.output(z.object({ repositories: z.array(GitHubRepositorySchema) }))
