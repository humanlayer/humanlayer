import { taskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import type { WorkspaceSetupState, WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'
import { WorkspaceSetupStateSchema, WorkspaceSpecSchema } from '@humanlayer/schemas/zod/workspace'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

import {
	deriveWorkspaceSetupStatus,
	makeInitialWorkspaceSetupState,
} from '../lib/workspace-setup/workspace-setup-ledger'

type DatabaseExecutor = PgDatabase<PostgresJsQueryResultHKT>

export type UpsertWorkspaceSetupRowForTaskSessionInput = {
	organizationId: string
	taskId: string
	hostId: string
	workspaceSpec: WorkspaceSpec | null
	finishedState?: WorkspaceSetupState
	initializeMissingMapping?: boolean
}

function makeWorkspaceSetupState({
	workspaceSpec,
	finishedState,
}: Pick<UpsertWorkspaceSetupRowForTaskSessionInput, 'workspaceSpec' | 'finishedState'>): WorkspaceSetupState {
	const parsedSpec = workspaceSpec === null ? null : WorkspaceSpecSchema.parse(workspaceSpec)
	if (finishedState !== undefined) {
		if (!parsedSpec) throw new Error('A finished workspace setup state requires a workspace spec')
		const parsedState = WorkspaceSetupStateSchema.parse(finishedState)
		const expectedPaths = new Set(parsedSpec.repos.map((repo) => repo.localPath))
		const actualPaths = new Set(parsedState.repos.map((repo) => repo.localPath))
		if (
			parsedState.specVersion !== parsedSpec.specVersion ||
			expectedPaths.size !== parsedSpec.repos.length ||
			actualPaths.size !== parsedState.repos.length ||
			expectedPaths.size !== actualPaths.size ||
			parsedState.repos.some((repo) => !expectedPaths.has(repo.localPath) || repo.status !== 'done')
		) {
			throw new Error('Finished workspace setup state does not match the workspace spec')
		}
		return parsedState.finishedAt === undefined ? { ...parsedState, finishedAt: Date.now() } : parsedState
	}
	if (parsedSpec) return WorkspaceSetupStateSchema.parse(makeInitialWorkspaceSetupState(parsedSpec))
	return { specVersion: 1, repos: [], finishedAt: Date.now() }
}

/**
 * Ensures the session's task has a host-scoped setup row in the caller's transaction.
 * A launch can initialize an empty mapping, but it never replaces a configured mapping.
 */
export async function upsertWorkspaceSetupRowForTaskSession(
	tx: DatabaseExecutor,
	input: UpsertWorkspaceSetupRowForTaskSessionInput,
) {
	const state = makeWorkspaceSetupState(input)
	const [materialized] = await tx
		.insert(taskWorkspaceSetupForHost)
		.values({
			organization_id: input.organizationId,
			task_id: input.taskId,
			host_id: input.hostId,
			status: deriveWorkspaceSetupStatus(state),
			resolved_workspace_spec: input.workspaceSpec,
			workspace_setup_state: state,
		})
		.onConflictDoUpdate({
			target: [
				taskWorkspaceSetupForHost.organization_id,
				taskWorkspaceSetupForHost.task_id,
				taskWorkspaceSetupForHost.host_id,
			],
			set: {
				status: deriveWorkspaceSetupStatus(state),
				resolved_workspace_spec: input.workspaceSpec,
				workspace_setup_state: state,
			},
			setWhere: input.initializeMissingMapping
				? isNull(taskWorkspaceSetupForHost.resolved_workspace_spec)
				: sql`false`,
		})
		.returning()

	if (materialized) {
		return { row: materialized, effectiveWorkspaceSpec: materialized.resolved_workspace_spec, materialized: true }
	}

	const [existing] = await tx
		.select()
		.from(taskWorkspaceSetupForHost)
		.where(
			and(
				eq(taskWorkspaceSetupForHost.organization_id, input.organizationId),
				eq(taskWorkspaceSetupForHost.task_id, input.taskId),
				eq(taskWorkspaceSetupForHost.host_id, input.hostId),
			),
		)
		.limit(1)
	if (!existing) throw new Error('Unable to materialize task workspace setup row')
	return { row: existing, effectiveWorkspaceSpec: existing.resolved_workspace_spec, materialized: false }
}
