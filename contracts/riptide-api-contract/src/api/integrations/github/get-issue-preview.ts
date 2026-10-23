import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { GitHubDecimalIdSchema, GitHubIssuePreviewSchema } from './schemas'

export const getGitHubIssuePreviewContract = contractBuilder
	.input(
		z.object({
			connectionId: z.uuid(),
			repositoryId: GitHubDecimalIdSchema,
			issueInput: z.string().min(1),
		}),
	)
	.output(GitHubIssuePreviewSchema)
