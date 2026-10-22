import {
	RepoWorkspaceSetupProgressSchema,
	WorkspaceSetupErrorSchema,
	WorkspaceStateSchema,
} from '@humanlayer/schemas/zod/workspace'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const updateDaemonWorkspaceSetupContract = contractBuilder
	.input(
		z
			.object({
				rowId: z.uuid(),
				taskId: z.uuid(),
				repo: RepoWorkspaceSetupProgressSchema.optional(),
				workspaceState: WorkspaceStateSchema.optional(),
				error: WorkspaceSetupErrorSchema.nullable().optional(),
			})
			.refine(
				(input) => input.repo !== undefined || input.workspaceState !== undefined || input.error !== undefined,
				{ message: 'workspace setup update must include repo progress, workspace state, or an error change' },
			),
	)
	.output(z.object({ transactionId: z.string() }))
