import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

/**
 * Item-scoped uninstall. Calls GitHub's app-authenticated installation deletion first and
 * removes local state only after GitHub confirms the uninstall. A cross-organization or
 * missing connection is `NOT_FOUND`; a GitHub failure that leaves local state intact maps to
 * `SERVICE_UNAVAILABLE` so the UI can surface a retry.
 */
export const disconnectGitHubContract = contractBuilder
	.input(z.object({ connectionId: z.uuid() }))
	.output(z.object({ success: z.boolean() }))
