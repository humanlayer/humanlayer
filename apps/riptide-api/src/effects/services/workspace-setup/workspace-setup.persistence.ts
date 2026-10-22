import {
	taskWorkspaceSetupForHost,
	taskWorkspaceSetupForHostSelectSchema,
} from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { tasks } from '@humanlayer/db/tables/tasks'
import {
	pinWorkspaceSpecSourceCommit,
	WorkspaceSpecSourceCommitPinResult,
} from '@humanlayer/db/utils/workspace-source-commit'
import type { WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'
import {
	WorkspaceSetupStageSchema,
	WorkspaceSourceCommitSchema,
	WorkspaceSpecSchema,
} from '@humanlayer/schemas/zod/workspace'
import { and, eq } from 'drizzle-orm'
import { Effect, Layer, Predicate } from 'effect'

import { Sentry } from '../../../instrument'
import {
	applyDaemonProgressUpdateToWorkspaceSetupState,
	applyRetryIntentToWorkspaceSetupState,
	applySkipIntentToWorkspaceSetupState,
	deriveWorkspaceSetupStatus,
	makeInitialWorkspaceSetupState,
	parseFinishedWorkspaceSetupStateForSpec,
} from '../../../lib/workspace-setup/workspace-setup-ledger'
import { getTransactionId } from '../postgres/helpers'
import { PostgresDbQueryError, PostgresDbTransactionError } from '../postgres/postgres-db.errors'
import { PostgresDb, type PostgresTransaction } from '../postgres/postgres-db.service'
import {
	WorkspaceSetupFinishedStateInvalidError,
	WorkspaceSetupInvalidStateError,
	WorkspaceSetupPersistenceError,
	WorkspaceSetupRetryConflictError,
	WorkspaceSetupRowNotFoundError,
	WorkspaceSetupSkipNotAllowedError,
	WorkspaceSetupStaleIntentError,
} from './workspace-setup.errors'
import { WorkspaceSetupPersistence } from './workspace-setup.persistence.service'
import type {
	ApplyDaemonWorkspaceSetupProgressInput,
	ReplaceWorkspaceSetupRepositoryDirectoryInput,
	WorkspaceSetupRow,
} from './workspace-setup.types'

type SetupRowSelect = typeof taskWorkspaceSetupForHost.$inferSelect

const parseSetupRow = (row: SetupRowSelect): Effect.Effect<WorkspaceSetupRow, WorkspaceSetupInvalidStateError> => {
	const parsed = taskWorkspaceSetupForHostSelectSchema.safeParse(row)
	if (!parsed.success || parsed.data.workspace_setup_state == null) {
		return Effect.fail(
			new WorkspaceSetupInvalidStateError({
				taskId: row.task_id,
				hostId: row.host_id,
				rowId: row.id,
				schemaName: 'workspace_setup_row',
				reason: 'Persisted workspace setup JSONB is invalid',
				cause: parsed.success ? undefined : parsed.error,
			}),
		)
	}
	const status = WorkspaceSetupStageSchema.safeParse(parsed.data.status)
	if (!status.success) {
		return Effect.fail(
			new WorkspaceSetupInvalidStateError({
				taskId: row.task_id,
				hostId: row.host_id,
				rowId: row.id,
				schemaName: 'workspace_setup_row',
				reason: 'Persisted workspace setup status is invalid',
				cause: status.error,
			}),
		)
	}
	return Effect.succeed({
		id: parsed.data.id,
		organizationId: parsed.data.organization_id,
		taskId: parsed.data.task_id,
		hostId: parsed.data.host_id,
		status: status.data,
		state: parsed.data.workspace_setup_state,
		error: parsed.data.error ?? null,
		createdAt: parsed.data.created_at,
		updatedAt: parsed.data.updated_at,
	})
}

const loadSetupRowForIntent = (
	tx: PostgresTransaction,
	input: { readonly organizationId: string; readonly taskId: string; readonly hostId: string },
) =>
	Effect.gen(function* () {
		const [row] = yield* tx.query(
			tx.client
				.select()
				.from(taskWorkspaceSetupForHost)
				.where(
					and(
						eq(taskWorkspaceSetupForHost.organization_id, input.organizationId),
						eq(taskWorkspaceSetupForHost.task_id, input.taskId),
						eq(taskWorkspaceSetupForHost.host_id, input.hostId),
					),
				)
				.for('no key update')
				.limit(1),
		)
		if (!row) {
			return yield* Effect.fail(
				new WorkspaceSetupRowNotFoundError({
					organizationId: input.organizationId,
					taskId: input.taskId,
					hostId: input.hostId,
				}),
			)
		}
		return yield* parseSetupRow(row)
	})

const persistTransition = (
	tx: PostgresTransaction,
	row: WorkspaceSetupRow,
	state: WorkspaceSetupRow['state'],
	error: WorkspaceSetupRow['error'],
) =>
	Effect.gen(function* () {
		const [updated] = yield* tx.query(
			tx.client
				.update(taskWorkspaceSetupForHost)
				.set({ workspace_setup_state: state, status: deriveWorkspaceSetupStatus(state), error })
				.where(
					and(
						eq(taskWorkspaceSetupForHost.id, row.id),
						eq(taskWorkspaceSetupForHost.updated_at, row.updatedAt),
					),
				)
				.returning(),
		)
		if (!updated) {
			return yield* Effect.fail(
				new WorkspaceSetupStaleIntentError({
					taskId: row.taskId,
					hostId: row.hostId,
					reason: 'The setup row changed before the intent was persisted',
				}),
			)
		}
		return yield* parseSetupRow(updated)
	})

const mapPostgresFailuresToWorkspaceSetupPersistenceError = <A, E, R>(
	program: Effect.Effect<A, E | PostgresDbQueryError | PostgresDbTransactionError, R>,
	input: {
		readonly operation: string
		readonly organizationId: string
		readonly taskId: string
		readonly hostId?: string
		readonly rowId?: string
	},
) =>
	program.pipe(
		Effect.tapErrorTag('PostgresDbQueryError', (error) =>
			Effect.sync(() =>
				Sentry.captureException(error, {
					tags: { error_type: 'PostgresDbQueryError', operation: input.operation },
					extra: {
						organizationId: input.organizationId,
						taskId: input.taskId,
						hostId: input.hostId,
						rowId: input.rowId,
					},
				}),
			),
		),
		Effect.tapErrorTag('PostgresDbTransactionError', (error) =>
			Effect.sync(() =>
				Sentry.captureException(error, {
					tags: { error_type: 'PostgresDbTransactionError', operation: input.operation },
					extra: {
						organizationId: input.organizationId,
						taskId: input.taskId,
						hostId: input.hostId,
						rowId: input.rowId,
					},
				}),
			),
		),
		Effect.catchTag('PostgresDbQueryError', (cause) =>
			Effect.fail(new WorkspaceSetupPersistenceError({ ...input, cause })),
		),
		Effect.catchTag('PostgresDbTransactionError', (cause) =>
			Effect.fail(new WorkspaceSetupPersistenceError({ ...input, cause })),
		),
	)

const parsePersistedTaskWorkspaceSpec = (
	value: unknown,
	input: ApplyDaemonWorkspaceSetupProgressInput,
): Effect.Effect<WorkspaceSpec | null, WorkspaceSetupInvalidStateError> => {
	if (Predicate.isNullish(value)) return Effect.succeed(null)
	const parsed = WorkspaceSpecSchema.safeParse(value)
	if (parsed.success) return Effect.succeed(parsed.data)
	return Effect.fail(
		new WorkspaceSetupInvalidStateError({
			taskId: input.taskId,
			hostId: input.authenticatedHostId,
			rowId: input.rowId,
			schemaName: 'workspace_spec',
			reason: 'Persisted task workspace specification is invalid',
			cause: parsed.error,
		}),
	)
}

const observeInvalidPersistedTaskWorkspaceSpec = (
	error: WorkspaceSetupInvalidStateError,
	input: ApplyDaemonWorkspaceSetupProgressInput,
) =>
	Effect.logError(error).pipe(
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(error.cause ?? error, {
					tags: { error_type: error._tag, schema_name: error.schemaName },
					extra: {
						organizationId: input.organizationId,
						taskId: input.taskId,
						hostId: input.authenticatedHostId,
						rowId: input.rowId,
					},
				}),
			),
		),
	)

const persistTaskWorkspaceSpecSourceCommit = (
	tx: PostgresTransaction,
	persistedWorkspaceSpec: unknown,
	input: ApplyDaemonWorkspaceSetupProgressInput,
): Effect.Effect<void, PostgresDbQueryError | WorkspaceSetupStaleIntentError> => {
	const repositoryProgress = input.repo
	if (repositoryProgress?.status !== 'worktree') return Effect.void

	const parsedSourceCommit = WorkspaceSourceCommitSchema.safeParse(repositoryProgress.preflight?.resolvedSourceCommit)
	if (!parsedSourceCommit.success) return Effect.void

	return Effect.gen(function* () {
		const workspaceSpec = yield* parsePersistedTaskWorkspaceSpec(persistedWorkspaceSpec, input).pipe(
			Effect.tapError((error) => observeInvalidPersistedTaskWorkspaceSpec(error, input)),
			Effect.catchTag('WorkspaceSetupInvalidStateError', () => Effect.succeed(null)),
		)
		if (Predicate.isNull(workspaceSpec)) return

		const sourceCommitPin = pinWorkspaceSpecSourceCommit({
			workspaceSpec,
			localPath: repositoryProgress.localPath,
			resolvedSourceCommit: parsedSourceCommit.data,
		})

		yield* WorkspaceSpecSourceCommitPinResult.$match(sourceCommitPin, {
			Pinned: ({ changed, workspaceSpec: pinnedWorkspaceSpec }) =>
				changed
					? tx
							.query(
								tx.client
									.update(tasks)
									.set({ workspace_spec: pinnedWorkspaceSpec })
									.where(
										and(
											eq(tasks.id, input.taskId),
											eq(tasks.organization_id, input.organizationId),
										),
									),
							)
							.pipe(Effect.asVoid)
					: Effect.void,
			RepositoryNotFound: () =>
				Effect.fail(
					new WorkspaceSetupStaleIntentError({
						taskId: input.taskId,
						hostId: input.authenticatedHostId,
						localPath: input.repo?.localPath,
						stage: input.repo?.status,
						reason: 'Daemon progress references a repository missing from the task workspace spec',
					}),
				),
			SourceCommitConflict: () => Effect.void,
		})
	})
}

export const applyDaemonWorkspaceSetupProgress = Effect.fn('workspace_setup.persistence.apply_daemon_progress_update')(
	function* (input: ApplyDaemonWorkspaceSetupProgressInput) {
		const postgres = yield* PostgresDb
		const program = postgres.transaction((tx) =>
			Effect.gen(function* () {
				const [task] = yield* tx.query(
					tx.client
						.select({ workspaceSpec: tasks.workspace_spec })
						.from(tasks)
						.where(and(eq(tasks.id, input.taskId), eq(tasks.organization_id, input.organizationId)))
						.for('no key update')
						.limit(1),
				)
				if (!task) {
					return yield* Effect.fail(
						new WorkspaceSetupRowNotFoundError({
							organizationId: input.organizationId,
							taskId: input.taskId,
							rowId: input.rowId,
						}),
					)
				}
				const [rawRow] = yield* tx.query(
					tx.client
						.select()
						.from(taskWorkspaceSetupForHost)
						.where(
							and(
								eq(taskWorkspaceSetupForHost.id, input.rowId),
								eq(taskWorkspaceSetupForHost.task_id, input.taskId),
								eq(taskWorkspaceSetupForHost.organization_id, input.organizationId),
								eq(taskWorkspaceSetupForHost.host_id, input.authenticatedHostId),
							),
						)
						.for('no key update')
						.limit(1),
				)
				if (!rawRow) {
					return yield* Effect.fail(
						new WorkspaceSetupRowNotFoundError({
							organizationId: input.organizationId,
							taskId: input.taskId,
							rowId: input.rowId,
						}),
					)
				}
				const row = yield* parseSetupRow(rawRow)
				const state = input.repo
					? yield* applyDaemonProgressUpdateToWorkspaceSetupState({
							state: row.state,
							repo: input.repo,
							taskId: input.taskId,
							hostId: input.authenticatedHostId,
						}).pipe(
							Effect.mapError(
								(error) =>
									new WorkspaceSetupStaleIntentError({
										taskId: input.taskId,
										hostId: input.authenticatedHostId,
										localPath: input.repo?.localPath,
										stage: input.repo?.status,
										reason: error.reason,
									}),
							),
						)
					: row.state
				const nextError = input.error === undefined ? row.error : input.error
				if (nextError) {
					const failedRepo = state.repos.find((repo) => repo.localPath === nextError.localPath)
					if (!failedRepo || failedRepo.status !== nextError.stage) {
						return yield* Effect.fail(
							new WorkspaceSetupStaleIntentError({
								taskId: input.taskId,
								hostId: input.authenticatedHostId,
								localPath: nextError.localPath,
								stage: nextError.stage,
								reason: 'The daemon error does not match the current repository stage',
							}),
						)
					}
				}
				yield* persistTaskWorkspaceSpecSourceCommit(tx, task.workspaceSpec, input)
				const updated = yield* persistTransition(tx, row, state, nextError)
				if (input.workspaceState) {
					const [updatedTask] = yield* tx.query(
						tx.client
							.update(tasks)
							.set({ workspace_state: input.workspaceState })
							.where(and(eq(tasks.id, input.taskId), eq(tasks.organization_id, input.organizationId)))
							.returning({ id: tasks.id }),
					)
					if (!updatedTask) {
						return yield* Effect.fail(
							new WorkspaceSetupRowNotFoundError({
								organizationId: input.organizationId,
								taskId: input.taskId,
								hostId: input.authenticatedHostId,
								rowId: input.rowId,
							}),
						)
					}
				}
				return { transactionId: yield* getTransactionId(tx), row: updated }
			}),
		)
		return yield* mapPostgresFailuresToWorkspaceSetupPersistenceError(program, {
			operation: 'apply_daemon_progress_update',
			organizationId: input.organizationId,
			taskId: input.taskId,
			hostId: input.authenticatedHostId,
			rowId: input.rowId,
		})
	},
)

export const WorkspaceSetupPersistenceLive = Layer.effect(
	WorkspaceSetupPersistence,
	Effect.gen(function* () {
		const postgres = yield* PostgresDb

		return {
			createSetupRowForTaskSession: (input) => {
				const program = postgres.transaction((tx) =>
					Effect.gen(function* () {
						let state
						if (input.finishedState) {
							if (!input.workspaceSpec) {
								return yield* Effect.fail(
									new WorkspaceSetupFinishedStateInvalidError({
										taskId: input.taskId,
										hostId: input.hostId,
										reason: 'A finished setup state requires a workspace spec',
									}),
								)
							}
							state = yield* parseFinishedWorkspaceSetupStateForSpec({
								spec: input.workspaceSpec,
								state: input.finishedState,
								taskId: input.taskId,
								hostId: input.hostId,
							})
							if (state.finishedAt === undefined) state = { ...state, finishedAt: input.now }
						} else if (input.workspaceSpec) {
							state = makeInitialWorkspaceSetupState(input.workspaceSpec)
						} else {
							state = { specVersion: 1, repos: [], finishedAt: input.now }
						}

						const status = deriveWorkspaceSetupStatus(state)
						const [inserted] = yield* tx.query(
							tx.client
								.insert(taskWorkspaceSetupForHost)
								.values({
									organization_id: input.organizationId,
									task_id: input.taskId,
									host_id: input.hostId,
									status,
									workspace_setup_state: state,
								})
								.onConflictDoNothing({
									target: [
										taskWorkspaceSetupForHost.organization_id,
										taskWorkspaceSetupForHost.task_id,
										taskWorkspaceSetupForHost.host_id,
									],
								})
								.returning(),
						)
						const selected = inserted
							? inserted
							: (yield* tx.query(
									tx.client
										.select()
										.from(taskWorkspaceSetupForHost)
										.where(
											and(
												eq(taskWorkspaceSetupForHost.organization_id, input.organizationId),
												eq(taskWorkspaceSetupForHost.task_id, input.taskId),
												eq(taskWorkspaceSetupForHost.host_id, input.hostId),
											),
										)
										.limit(1),
								))[0]
						if (!selected) {
							return yield* Effect.fail(
								new WorkspaceSetupRowNotFoundError({
									organizationId: input.organizationId,
									taskId: input.taskId,
									hostId: input.hostId,
								}),
							)
						}
						return { transactionId: yield* getTransactionId(tx), row: yield* parseSetupRow(selected) }
					}),
				)
				return mapPostgresFailuresToWorkspaceSetupPersistenceError(program, {
					...input,
					operation: 'create_setup_row',
				})
			},

			applyRetryIntent: (input) => {
				const program = postgres.transaction((tx) =>
					Effect.gen(function* () {
						const row = yield* loadSetupRowForIntent(tx, input)
						const transition = yield* applyRetryIntentToWorkspaceSetupState({
							state: row.state,
							error: row.error,
							localPath: input.localPath,
							stage: input.stage,
							taskId: input.taskId,
							hostId: input.hostId,
						}).pipe(
							Effect.catchTags({
								WorkspaceSetupRetryConflictError: () =>
									Effect.fail(new WorkspaceSetupRetryConflictError({ ...input })),
								WorkspaceSetupStaleIntentError: (error) =>
									Effect.fail(new WorkspaceSetupStaleIntentError({ ...input, reason: error.reason })),
							}),
						)
						const updated = yield* persistTransition(tx, row, transition.state, transition.error)
						return { transactionId: yield* getTransactionId(tx), row: updated }
					}),
				)
				return mapPostgresFailuresToWorkspaceSetupPersistenceError(program, {
					...input,
					operation: 'apply_retry_intent',
				})
			},

			applySkipIntent: (input) => {
				const program = postgres.transaction((tx) =>
					Effect.gen(function* () {
						const row = yield* loadSetupRowForIntent(tx, input)
						const transition = yield* applySkipIntentToWorkspaceSetupState({
							state: row.state,
							error: row.error,
							localPath: input.localPath,
							stage: input.stage,
							userId: input.userId,
							now: input.now,
							taskId: input.taskId,
							hostId: input.hostId,
						}).pipe(
							Effect.catchTags({
								WorkspaceSetupRetryConflictError: () =>
									Effect.fail(new WorkspaceSetupRetryConflictError({ ...input })),
								WorkspaceSetupSkipNotAllowedError: () =>
									Effect.fail(new WorkspaceSetupSkipNotAllowedError({ ...input })),
								WorkspaceSetupStaleIntentError: (error) =>
									Effect.fail(new WorkspaceSetupStaleIntentError({ ...input, reason: error.reason })),
							}),
						)
						const updated = yield* persistTransition(tx, row, transition.state, transition.error)
						return { transactionId: yield* getTransactionId(tx), row: updated }
					}),
				)
				return mapPostgresFailuresToWorkspaceSetupPersistenceError(program, {
					...input,
					operation: 'apply_skip_intent',
				})
			},

			replaceRepositoryDirectory: (input: ReplaceWorkspaceSetupRepositoryDirectoryInput & { now: number }) => {
				const program = postgres.transaction((tx) =>
					Effect.gen(function* () {
						const row = yield* loadSetupRowForIntent(tx, input)
						if (row.updatedAt !== input.expectedUpdatedAt) {
							return yield* Effect.fail(
								new WorkspaceSetupStaleIntentError({
									taskId: input.taskId,
									hostId: input.hostId,
									reason: 'The setup row changed after the repository location dialog opened',
								}),
							)
						}
						const state = makeInitialWorkspaceSetupState(input.resolvedWorkspaceSpec)
						const currentTime = BigInt(input.now)
						const nextUpdatedAt = currentTime > row.updatedAt ? currentTime : row.updatedAt + 1n
						const [updated] = yield* tx.query(
							tx.client
								.update(taskWorkspaceSetupForHost)
								.set({
									resolved_workspace_spec: input.resolvedWorkspaceSpec,
									workspace_setup_state: state,
									status: deriveWorkspaceSetupStatus(state),
									error: null,
									updated_at: nextUpdatedAt,
								})
								.where(
									and(
										eq(taskWorkspaceSetupForHost.id, row.id),
										eq(taskWorkspaceSetupForHost.updated_at, row.updatedAt),
									),
								)
								.returning(),
						)
						if (!updated) {
							return yield* Effect.fail(
								new WorkspaceSetupStaleIntentError({
									taskId: input.taskId,
									hostId: input.hostId,
									reason: 'The setup row changed before the repository location was persisted',
								}),
							)
						}
						return { transactionId: yield* getTransactionId(tx), row: yield* parseSetupRow(updated) }
					}),
				)
				return mapPostgresFailuresToWorkspaceSetupPersistenceError(program, {
					...input,
					operation: 'replace_repository_directory',
				})
			},

			applyDaemonProgressUpdate: (input) => {
				return applyDaemonWorkspaceSetupProgress(input)
			},
		}
	}),
)
