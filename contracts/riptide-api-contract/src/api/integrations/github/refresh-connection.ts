import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { GitHubConnectionSchema } from './schemas'

/**
 * Item-scoped reconciliation of one installation against GitHub's current state. Returns the
 * refreshed connection projection (lifecycle status, permission grant, derived capabilities,
 * and repository count). A cross-organization or missing connection is `NOT_FOUND`; a
 * suspended installation cannot be refreshed and maps to `BAD_REQUEST`.
 */
export const refreshGitHubConnectionContract = contractBuilder
	.input(z.object({ connectionId: z.uuid() }))
	.output(z.object({ connection: GitHubConnectionSchema }))
