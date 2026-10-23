import type {
	WorkspaceBranchPublishStatus,
	WorkspaceFileCopyResult,
	WorkspaceRepositorySetupError,
	WorkspaceRepositoryAcceptedSkip,
	WorkspaceRepositorySetupStage,
	WorkspaceRepositorySourceKind,
	WorkspaceRepositorySourcePolicy,
	WorkspaceSetupCommandResult,
	WorktreeMaterialization,
} from '@humanlayer/schemas/effect/project-workspace'
import {
	GitCommitShaSchema,
	NormalizedRepositoryIdentitySchema,
	WorkspaceBranchPublishStatusSchema,
	WorkspaceFileCopyResultSchema,
	WorkspaceRepositorySetupErrorSchema,
	WorkspaceRepositoryAcceptedSkipSchema,
	WorkspaceRepositorySetupStageSchema,
	WorkspaceRepositorySourceKindSchema,
	WorkspaceRepositorySourcePolicySchema,
	WorkspaceSetupCommandResultSchema,
	WorktreeMaterializationSchema,
} from '@humanlayer/schemas/zod/project-workspace'
import { sql } from 'drizzle-orm'
import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'

import { jsonbParser } from '../utils/jsonb-parser'
import { organizations } from './organizations'
import { projects } from './projects'
import { workspaces } from './workspaces'

export const workspaceRepositoryStatusForUserForHost = pgTable(
	'workspace_repository_status_for_user_for_host',
	{
		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		project_id: uuid()
			.references(() => projects.id, { onDelete: 'cascade' })
			.notNull(),
		workspace_id: uuid()
			.references(() => workspaces.id, { onDelete: 'cascade' })
			.notNull(),
		user_id: text().notNull(),
		host_id: text().notNull(),
		repository_identity: text().notNull(),
		repository_remote_url: text().notNull(),
		status: text().$type<WorkspaceRepositorySetupStage>().notNull().default('setup_requested'),
		repo_available: boolean().notNull().default(false),
		source_policy: text().$type<WorkspaceRepositorySourcePolicy>(),
		source_kind: text().$type<WorkspaceRepositorySourceKind>(),
		source_path: text(),
		resolved_commit: text(),
		materialization: jsonb().$type<WorktreeMaterialization>(),
		branch_publish_status: text().$type<WorkspaceBranchPublishStatus>(),
		copy_result: jsonb().$type<WorkspaceFileCopyResult>(),
		setup_command_result: jsonb().$type<WorkspaceSetupCommandResult>(),
		accepted_skips: jsonb().$type<WorkspaceRepositoryAcceptedSkip[]>().notNull().default([]),
		error: jsonb().$type<WorkspaceRepositorySetupError>(),
		generation: bigint({ mode: 'bigint' })
			.notNull()
			.default(sql`1`),
		current_branch: text(),
		local_head: text(),
		remote_head: text(),
		ahead_count: integer(),
		behind_count: integer(),
		dirty: boolean(),
		git_state_checked_at: bigint({ mode: 'bigint' }),
		created_at: bigint({ mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),
		updated_at: bigint({ mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now()))
			.$onUpdateFn(() => BigInt(Date.now())),
	},
	(t) => [
		primaryKey({
			name: 'workspace_repository_status_for_user_for_host_pk',
			columns: [t.organization_id, t.project_id, t.workspace_id, t.user_id, t.host_id, t.repository_identity],
		}),
		index('workspace_repository_status_org_user_host_idx').on(t.organization_id, t.user_id, t.host_id, t.status),
	],
)

const workspaceRepositoryStatusJsonSchemas = {
	materialization: WorktreeMaterializationSchema.nullish(),
	copy_result: WorkspaceFileCopyResultSchema.nullish(),
	setup_command_result: WorkspaceSetupCommandResultSchema.nullish(),
	accepted_skips: WorkspaceRepositoryAcceptedSkipSchema.array().optional(),
	error: WorkspaceRepositorySetupErrorSchema.nullish(),
}

export const workspaceRepositoryStatusSelectSchema = createSelectSchema(workspaceRepositoryStatusForUserForHost, {
	repository_identity: NormalizedRepositoryIdentitySchema,
	status: WorkspaceRepositorySetupStageSchema,
	source_policy: WorkspaceRepositorySourcePolicySchema.nullable(),
	source_kind: WorkspaceRepositorySourceKindSchema.nullable(),
	resolved_commit: GitCommitShaSchema.nullable(),
	branch_publish_status: WorkspaceBranchPublishStatusSchema.nullable(),
	materialization: jsonbParser(WorktreeMaterializationSchema.nullable()),
	copy_result: jsonbParser(WorkspaceFileCopyResultSchema.nullable()),
	setup_command_result: jsonbParser(WorkspaceSetupCommandResultSchema.nullable()),
	accepted_skips: jsonbParser(WorkspaceRepositoryAcceptedSkipSchema.array()),
	error: jsonbParser(WorkspaceRepositorySetupErrorSchema.nullable()),
	local_head: GitCommitShaSchema.nullable(),
	remote_head: GitCommitShaSchema.nullable(),
})
export const workspaceRepositoryStatusInsertSchema = createInsertSchema(workspaceRepositoryStatusForUserForHost, {
	repository_identity: NormalizedRepositoryIdentitySchema,
	status: WorkspaceRepositorySetupStageSchema.optional(),
	source_policy: WorkspaceRepositorySourcePolicySchema.nullish(),
	source_kind: WorkspaceRepositorySourceKindSchema.nullish(),
	resolved_commit: GitCommitShaSchema.nullish(),
	branch_publish_status: WorkspaceBranchPublishStatusSchema.nullish(),
	local_head: GitCommitShaSchema.nullish(),
	remote_head: GitCommitShaSchema.nullish(),
	...workspaceRepositoryStatusJsonSchemas,
})
export const workspaceRepositoryStatusUpdateSchema = createUpdateSchema(workspaceRepositoryStatusForUserForHost, {
	repository_identity: NormalizedRepositoryIdentitySchema.optional(),
	status: WorkspaceRepositorySetupStageSchema.optional(),
	source_policy: WorkspaceRepositorySourcePolicySchema.nullish(),
	source_kind: WorkspaceRepositorySourceKindSchema.nullish(),
	resolved_commit: GitCommitShaSchema.nullish(),
	branch_publish_status: WorkspaceBranchPublishStatusSchema.nullish(),
	local_head: GitCommitShaSchema.nullish(),
	remote_head: GitCommitShaSchema.nullish(),
	...workspaceRepositoryStatusJsonSchemas,
})
export type WorkspaceRepositoryStatusForUserForHost = typeof workspaceRepositoryStatusForUserForHost.$inferSelect
export type NewWorkspaceRepositoryStatusForUserForHost = typeof workspaceRepositoryStatusForUserForHost.$inferInsert
