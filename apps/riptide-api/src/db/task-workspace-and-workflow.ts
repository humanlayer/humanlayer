import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { taskUserSettings } from '@humanlayer/db/tables/task-user-settings'
import type { tasks } from '@humanlayer/db/tables/tasks'
import {
	pinWorkspaceSpecSourceCommit,
	WorkspaceSpecSourceCommitPinResult,
} from '@humanlayer/db/utils/workspace-source-commit'
import type { TaskWorkspaceAndWorkflowConfiguration } from '@humanlayer/riptide-api-contract/api/tasks/create'
import { WorkspaceSourceCommitSchema } from '@humanlayer/schemas/zod/workspace'
import { sql } from 'drizzle-orm'

import type { PostgresDbClient } from '../effects/services/postgres/postgres-db.service'
import { resolveOrgDefaultTaskShareLevel } from './organization-settings'
import { upsertWorkspaceSetupRowForTaskSession } from './upsert-workspace-setup-row-for-task-session'

export function buildTaskWorkspaceAndWorkflowValues(input: TaskWorkspaceAndWorkflowConfiguration) {
	let workspaceSpec = input.workspaceSpec
	if (workspaceSpec && input.workspaceSetupState) {
		let pinnedWorkspaceSpec = workspaceSpec
		const resolvedSourceCommitByLocalPath = new Map(
			input.workspaceSetupState.repos.flatMap((repository) =>
				repository.preflight?.resolvedSourceCommit === undefined
					? []
					: [[repository.localPath, repository.preflight.resolvedSourceCommit] as const],
			),
		)
		for (const repository of pinnedWorkspaceSpec.repos) {
			const parsedSourceCommit = WorkspaceSourceCommitSchema.safeParse(
				resolvedSourceCommitByLocalPath.get(repository.localPath),
			)
			if (!parsedSourceCommit.success) continue
			const pin = pinWorkspaceSpecSourceCommit({
				workspaceSpec: pinnedWorkspaceSpec,
				localPath: repository.localPath,
				resolvedSourceCommit: parsedSourceCommit.data,
			})
			pinnedWorkspaceSpec = WorkspaceSpecSourceCommitPinResult.$match(pin, {
				Pinned: ({ workspaceSpec: nextWorkspaceSpec }) => nextWorkspaceSpec,
				RepositoryNotFound: () => pinnedWorkspaceSpec,
				SourceCommitConflict: () => pinnedWorkspaceSpec,
			})
		}
		workspaceSpec = pinnedWorkspaceSpec
	}

	return {
		workspaceSpec,
		effectiveWorktreeTiming: workspaceSpec ? ('now' as const) : (input.worktreeTiming ?? ('later' as const)),
		taskValues: {
			name: input.name,
			default_working_directory: input.defaultWorkingDirectory ?? null,
			workspace_state: input.workspaceState ?? null,
			workspace_spec: workspaceSpec ?? null,
			setup_status: input.setupStatus ?? null,
			workflow_type: input.workflowType ?? ('freeform' as const),
			worktree_timing: workspaceSpec ? ('now' as const) : (input.worktreeTiming ?? ('later' as const)),
			auto_advance_questions_to_research: input.autoAdvanceQuestionsToResearch ?? false,
			auto_advance_research_to_design: input.autoAdvanceResearchToDesign ?? false,
			auto_advance_plan_to_worktree: input.autoAdvancePlanToWorktree ?? false,
			auto_advance_worktree_to_implementation: input.autoAdvanceWorktreeToImplementation ?? false,
			auto_advance_implementation_to_pr: input.autoAdvanceImplementationToPr ?? false,
		} satisfies Partial<typeof tasks.$inferInsert>,
	}
}

export async function createTaskWorkspaceAndWorkflowRecords(
	tx: PostgresDbClient,
	input: {
		taskId: string
		organizationId: string
		userId: string
		configuration: TaskWorkspaceAndWorkflowConfiguration
		workspaceSpec: ReturnType<typeof buildTaskWorkspaceAndWorkflowValues>['workspaceSpec']
		setupHostId?: string
	},
) {
	const defaultTaskShareLevel = await resolveOrgDefaultTaskShareLevel(tx, input.organizationId)
	await tx
		.insert(taskOrganizationAcl)
		.values({
			organization_id: input.organizationId,
			task_id: input.taskId,
			resource_owner_user_id: input.userId,
			permission_level: defaultTaskShareLevel,
			granted_by: input.userId,
		})
		.onConflictDoNothing({ target: [taskOrganizationAcl.organization_id, taskOrganizationAcl.task_id] })

	if (input.configuration.workspaceState) {
		const now = BigInt(Date.now())
		await tx
			.insert(taskUserSettings)
			.values({
				task_id: input.taskId,
				user_id: input.userId,
				organization_id: input.organizationId,
				workspace_base_directory: input.configuration.localWorkspaceBaseDirectory ?? null,
				workspace_materialized_at: now,
				host_id: input.configuration.hostId ?? null,
			})
			.onConflictDoUpdate({
				target: [taskUserSettings.organization_id, taskUserSettings.user_id, taskUserSettings.task_id],
				set: {
					workspace_base_directory: input.configuration.localWorkspaceBaseDirectory ?? null,
					workspace_materialized_at: now,
					host_id: input.configuration.hostId ?? null,
					updated_at: sql`${now}`,
				},
			})
	}

	if (input.setupHostId) {
		const setupRowInput: Parameters<typeof upsertWorkspaceSetupRowForTaskSession>[1] = {
			organizationId: input.organizationId,
			taskId: input.taskId,
			hostId: input.setupHostId,
			workspaceSpec: input.workspaceSpec ?? null,
		}
		if (input.configuration.workspaceSetupState) {
			setupRowInput.finishedState = input.configuration.workspaceSetupState
		}
		await upsertWorkspaceSetupRowForTaskSession(tx, setupRowInput)
	}
}
