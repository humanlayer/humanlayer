import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { GitHubConnectionSchema } from './schemas'

export const listGitHubConnectionsContract = contractBuilder
	.input(z.object({}).optional())
	.output(z.object({ enabled: z.boolean(), connections: z.array(GitHubConnectionSchema) }))
