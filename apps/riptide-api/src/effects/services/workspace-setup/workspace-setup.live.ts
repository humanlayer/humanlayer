import { WorkspaceSetupStateSchema, WorkspaceSpecSchema } from '@humanlayer/schemas/zod/workspace'
import { Clock, Effect, Layer } from 'effect'

import { Sentry } from '../../../instrument'
import { WorkspaceSetupInvalidSpecError, WorkspaceSetupInvalidStateError } from './workspace-setup.errors'
import {
	narrowCreateWorkspaceSetupErrors,
	narrowDaemonWorkspaceSetupUpdateErrors,
	narrowWorkspaceSetupIntentErrors,
} from './workspace-setup.narrowing'
import { WorkspaceSetupPersistence } from './workspace-setup.persistence.service'
import { WorkspaceSetupService } from './workspace-setup.service'
import type { CreateSetupRowForTaskSessionInput } from './workspace-setup.types'

const parseCreateInput = (input: CreateSetupRowForTaskSessionInput) =>
	Effect.gen(function* () {
		const workspaceSpec = input.workspaceSpec ? WorkspaceSpecSchema.safeParse(input.workspaceSpec) : null
		if (workspaceSpec && !workspaceSpec.success) {
			return yield* Effect.fail(
				new WorkspaceSetupInvalidSpecError({
					taskId: input.taskId,
					hostId: input.hostId,
					cause: workspaceSpec.error,
				}),
			)
		}
		const finishedState = input.finishedState ? WorkspaceSetupStateSchema.safeParse(input.finishedState) : null
		if (finishedState && !finishedState.success) {
			return yield* Effect.fail(
				new WorkspaceSetupInvalidStateError({
					taskId: input.taskId,
					hostId: input.hostId,
					schemaName: 'workspace_setup_state',
					reason: 'Finished setup state did not match its schema',
					cause: finishedState.error,
				}),
			)
		}
		const parsedInput: CreateSetupRowForTaskSessionInput = {
			...input,
			workspaceSpec: workspaceSpec?.data ?? null,
		}
		if (!finishedState) return parsedInput
		return { ...parsedInput, finishedState: finishedState.data }
	})

export const WorkspaceSetupServiceLive = Layer.effect(
	WorkspaceSetupService,
	Effect.gen(function* () {
		const persistence = yield* WorkspaceSetupPersistence

		return {
			createSetupRowForTaskSession: (input: CreateSetupRowForTaskSessionInput) => {
				const attributes = {
					organization_id: input.organizationId,
					task_id: input.taskId,
					host_id: input.hostId,
				}
				return Effect.gen(function* () {
					const parsed = yield* parseCreateInput(input)
					const now = yield* Clock.currentTimeMillis
					return yield* persistence.createSetupRowForTaskSession({ ...parsed, now })
				}).pipe(
					Effect.tapDefect((cause) =>
						Effect.sync(() =>
							Sentry.captureException(cause, {
								tags: { error_type: 'workspace_setup_defect' },
								extra: attributes,
							}),
						),
					),
					Effect.tapError((error) => Effect.logError(error).pipe(Effect.annotateLogs(attributes))),
					narrowCreateWorkspaceSetupErrors,
					Effect.tap((result) =>
						Effect.logInfo('Workspace setup row ready').pipe(
							Effect.annotateLogs({
								...attributes,
								setup_row_id: result.row.id,
								status: result.row.status,
							}),
						),
					),
					Effect.withSpan('workspace_setup.create_setup_row_for_task_session', { attributes }),
				)
			},

			applyRetryIntent: (input) => {
				const attributes = {
					organization_id: input.organizationId,
					task_id: input.taskId,
					host_id: input.hostId,
					local_path: input.localPath,
					stage: input.stage,
				}
				return persistence.applyRetryIntent(input).pipe(
					Effect.tapDefect((cause) =>
						Effect.sync(() => Sentry.captureException(cause, { extra: attributes })),
					),
					Effect.tapError((error) => Effect.logError(error).pipe(Effect.annotateLogs(attributes))),
					narrowWorkspaceSetupIntentErrors,
					Effect.tap((result) =>
						Effect.logInfo('Workspace setup operation completed').pipe(
							Effect.annotateLogs({
								...attributes,
								operation: 'apply_retry_intent',
								setup_row_id: result.row.id,
								status: result.row.status,
							}),
						),
					),
					Effect.withSpan('workspace_setup.apply_retry_intent', { attributes }),
				)
			},

			applySkipIntent: (input) => {
				const attributes = {
					organization_id: input.organizationId,
					task_id: input.taskId,
					host_id: input.hostId,
					local_path: input.localPath,
					stage: input.stage,
				}
				return Effect.gen(function* () {
					const now = yield* Clock.currentTimeMillis
					return yield* persistence.applySkipIntent({ ...input, now })
				}).pipe(
					Effect.tapDefect((cause) =>
						Effect.sync(() => Sentry.captureException(cause, { extra: attributes })),
					),
					Effect.tapError((error) => Effect.logError(error).pipe(Effect.annotateLogs(attributes))),
					narrowWorkspaceSetupIntentErrors,
					Effect.tap((result) =>
						Effect.logInfo('Workspace setup operation completed').pipe(
							Effect.annotateLogs({
								...attributes,
								operation: 'apply_skip_intent',
								setup_row_id: result.row.id,
								status: result.row.status,
							}),
						),
					),
					Effect.withSpan('workspace_setup.apply_skip_intent', { attributes }),
				)
			},

			replaceRepositoryDirectory: (input) => {
				const attributes = {
					organization_id: input.organizationId,
					task_id: input.taskId,
					host_id: input.hostId,
				}
				return Effect.gen(function* () {
					const parsedSpec = WorkspaceSpecSchema.safeParse(input.resolvedWorkspaceSpec)
					if (!parsedSpec.success) {
						return yield* Effect.fail(
							new WorkspaceSetupInvalidSpecError({
								taskId: input.taskId,
								hostId: input.hostId,
								cause: parsedSpec.error,
							}),
						)
					}
					const now = yield* Clock.currentTimeMillis
					return yield* persistence.replaceRepositoryDirectory({
						...input,
						resolvedWorkspaceSpec: parsedSpec.data,
						now,
					})
				}).pipe(
					Effect.tapDefect((cause) =>
						Effect.sync(() => Sentry.captureException(cause, { extra: attributes })),
					),
					Effect.tapError((error) => Effect.logError(error).pipe(Effect.annotateLogs(attributes))),
					narrowWorkspaceSetupIntentErrors,
					Effect.withSpan('workspace_setup.replace_repository_directory', { attributes }),
				)
			},

			applyDaemonProgressUpdate: (input) => {
				const attributes = {
					organization_id: input.organizationId,
					task_id: input.taskId,
					host_id: input.authenticatedHostId,
					setup_row_id: input.rowId,
					local_path: input.repo?.localPath,
					stage: input.repo?.status,
				}
				return persistence.applyDaemonProgressUpdate(input).pipe(
					Effect.tapDefect((cause) =>
						Effect.sync(() => Sentry.captureException(cause, { extra: attributes })),
					),
					Effect.tapError((error) => Effect.logError(error).pipe(Effect.annotateLogs(attributes))),
					narrowDaemonWorkspaceSetupUpdateErrors,
					Effect.tap((result) =>
						Effect.logInfo('Workspace setup operation completed').pipe(
							Effect.annotateLogs({
								...attributes,
								operation: 'apply_daemon_progress_update',
								setup_row_id: result.row.id,
								status: result.row.status,
							}),
						),
					),
					Effect.withSpan('workspace_setup.apply_daemon_progress_update', { attributes }),
				)
			},
		}
	}),
)
