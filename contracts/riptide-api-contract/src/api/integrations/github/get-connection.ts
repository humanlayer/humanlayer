import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { GitHubConnectionSchema } from './schemas'

export const getGitHubConnectionContract = contractBuilder
	.input(z.object({ connectionId: z.uuid() }))
	.output(z.object({ connection: GitHubConnectionSchema }))
